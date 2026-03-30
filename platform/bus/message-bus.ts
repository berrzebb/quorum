/**
 * Message Bus — thin structured layer over EventStore for finding-level communication.
 *
 * Replaces file-based agent communication with SQLite-backed message passing.
 * Reviewers INSERT findings → main thread polls → author acks per finding.
 *
 * Design: SQLite WAL mode enables concurrent read/write across processes.
 * No tmux/psmux needed — raw child_process.spawn + shared DB is sufficient.
 */

import { randomUUID } from "node:crypto";
import type { EventStore } from "./store.js";
import {
  SEVERITY_RANK,
  type Finding,
  type FindingSeverity,
  type FindingStatus,
  type FindingDetectPayload,
  type FindingAckPayload,
  type FindingResolvePayload,
  type AgentQueryPayload,
  type AgentResponsePayload,
  type ContextSavePayload,
  type ProviderKind,
  type QuorumEvent,
  type EventType,
} from "./events.js";
import { createEvent } from "./events.js";

export type { Finding, FindingSeverity, FindingStatus };

// ── Progressive Disclosure Types ─────────────

/** Layer 1: Lightweight summary (~50 tokens per finding). */
export interface FindingSummary {
  id: string;
  severity: FindingSeverity;
  category: string;
  file?: string;
  line?: number;
  status: FindingStatus;
  detectedBy: string[];
  consensusScore: number;
}

/** Layer 2: Context with description + nearby findings (~200 tokens). */
export interface FindingContext extends FindingSummary {
  description: string;
  provider: string;
  nearbyFindings: FindingSummary[];
  timeline: Array<{ action: string; timestamp: number; source: string }>;
}

/** Layer 3: Full detail with suggestion + per-reviewer breakdown (~500 tokens). */
export interface FindingDetail extends FindingContext {
  suggestion?: string;
  reviewerDetails: Array<{ reviewerId: string; provider: string; description: string }>;
}

/** A threaded conversation: root finding + chronological replies + timeline. */
export interface FindingThread {
  root: Finding;
  replies: Finding[];
  timeline: Array<{ action: string; timestamp: number; source: string; reviewerId?: string }>;
}

// ── Options interfaces for cleaner APIs ──────

export interface SubmitFindingsOpts {
  findings: Array<Omit<Finding, "id" | "status">>;
  source: ProviderKind;
  reviewerId: string;
  provider: string;
}

export interface PostQueryOpts {
  fromAgent: string;
  question: string;
  source?: ProviderKind;
  toAgent?: string;
  context?: Record<string, unknown>;
}

export interface RespondToQueryOpts {
  queryId: string;
  fromAgent: string;
  answer: string;
  source?: ProviderKind;
  confidence?: number;
}

export interface ReplyToFindingOpts {
  parentId: string;
  reply: Omit<Finding, "id" | "status" | "replyTo">;
  source: ProviderKind;
  reviewerId: string;
  provider: string;
}

export class MessageBus {
  private store: EventStore;

  // ── Invalidation-based cache ──
  // Cleared on any write operation (submit, ack, resolve, reply).
  // Avoids repeated full-table scans within a single read cycle.
  private _cache: {
    raw?: Finding[];
    closed?: Set<string>;
    detects?: QuorumEvent[];
    acks?: QuorumEvent[];
    resolves?: QuorumEvent[];
  } = {};

  constructor(store: EventStore) {
    this.store = store;
  }

  /** Invalidate read caches. Called after any write operation. */
  private _invalidate(): void {
    this._cache = {};
  }

  /**
   * Submit findings from a reviewer. Called by reviewer processes.
   * Each finding gets a unique ID and is stored as an event.
   *
   * Accepts either an options object or positional args (legacy).
   */
  submitFindings(opts: SubmitFindingsOpts): string[];
  submitFindings(findings: Array<Omit<Finding, "id" | "status">>, source: ProviderKind, reviewerId: string, provider: string): string[];
  submitFindings(
    findingsOrOpts: Array<Omit<Finding, "id" | "status">> | SubmitFindingsOpts,
    source?: ProviderKind,
    reviewerId?: string,
    provider?: string,
  ): string[] {
    const { findings, source: src, reviewerId: rid, provider: prov } = Array.isArray(findingsOrOpts)
      ? { findings: findingsOrOpts, source: source!, reviewerId: reviewerId!, provider: provider! }
      : findingsOrOpts;
    const ids: string[] = [];
    const fullFindings: Finding[] = [];

    for (const f of findings) {
      const id = `F-${randomUUID().slice(0, 8)}`;
      const finding: Finding = { ...f, id, status: "open" };
      fullFindings.push(finding);
      ids.push(id);
    }

    // Store as a single finding.detect event with all findings in payload
    const event = createEvent("finding.detect", src, {
      findings: fullFindings,
      reviewerId: rid,
      provider: prov,
    } satisfies FindingDetectPayload);

    this.store.append(event);

    // Record all findings as state transitions in a single batch transaction
    try {
      const transitions = fullFindings.map(f => ({
        entityType: "finding" as const,
        entityId: f.id,
        toState: "open" as const,
        source: prov,
        metadata: {
          severity: f.severity,
          category: f.category,
          description: f.description,
          file: f.file,
          line: f.line,
          reviewerId: rid,
        },
      }));
      this.store.commitTransaction([], transitions, []);
    } catch (err) { console.warn(`[message-bus] submitFindings state transition failed: ${(err as Error).message}`); }

    this._invalidate();
    return ids;
  }

  /**
   * Poll for findings since a timestamp. Called by main thread.
   */
  pollFindings(since: number): Finding[] {
    // Direct SQL query with since — leverages timestamp index, avoids loading all historical events
    const events = this.store.query({ eventType: "finding.detect", since });
    const findings: Finding[] = [];
    for (const event of events) {
      const payload = event.payload as unknown as FindingDetectPayload;
      if (payload.findings) findings.push(...payload.findings);
    }
    return findings;
  }

  /**
   * Acknowledge a finding (fix or dismiss). Called by author.
   */
  ackFinding(
    findingId: string,
    action: "fix" | "dismiss",
    source: ProviderKind = "claude-code",
    reason?: string,
  ): void {
    const event = createEvent("finding.ack", source, {
      findingId,
      action,
      reason,
    } satisfies FindingAckPayload);

    this.store.append(event);

    // Update state transition
    const newState = action === "fix" ? "confirmed" : "dismissed";
    try {
      this.store.commitTransaction([], [{
        entityType: "finding",
        entityId: findingId,
        fromState: "open",
        toState: newState,
        source: source,
      }], []);
    } catch (err) { console.warn(`[message-bus] ackFinding state transition failed: ${(err as Error).message}`); }
    this._invalidate();
  }

  /**
   * Resolve a finding (after fix is applied). Called by system.
   */
  resolveFinding(
    findingId: string,
    resolution: "fixed" | "dismissed" | "superseded",
    source: ProviderKind = "claude-code",
  ): void {
    const event = createEvent("finding.resolve", source, {
      findingId,
      resolution,
    } satisfies FindingResolvePayload);

    this.store.append(event);

    try {
      this.store.commitTransaction([], [{
        entityType: "finding",
        entityId: findingId,
        toState: resolution,
        source: source,
      }], []);
    } catch (err) { console.warn(`[message-bus] resolveFinding state transition failed: ${(err as Error).message}`); }
    this._invalidate();
  }

  // ── Conversation Threading ──────────────────

  /**
   * Reply to an existing finding. Creates a new finding linked to the parent.
   * Used for: Reviewer-B responds to Reviewer-A's finding, building a thread.
   *
   * Accepts either an options object or positional args (legacy).
   */
  replyToFinding(opts: ReplyToFindingOpts): string;
  replyToFinding(parentId: string, reply: Omit<Finding, "id" | "status" | "replyTo">, source: ProviderKind, reviewerId: string, provider: string): string;
  replyToFinding(
    parentIdOrOpts: string | ReplyToFindingOpts,
    reply?: Omit<Finding, "id" | "status" | "replyTo">,
    source?: ProviderKind,
    reviewerId?: string,
    provider?: string,
  ): string {
    const opts = typeof parentIdOrOpts === "string"
      ? { parentId: parentIdOrOpts, reply: reply!, source: source!, reviewerId: reviewerId!, provider: provider! }
      : parentIdOrOpts;

    const id = `F-${randomUUID().slice(0, 8)}`;
    const finding: Finding = { ...opts.reply, id, status: "open", replyTo: opts.parentId };

    const event = createEvent("finding.detect", opts.source, {
      findings: [finding],
      reviewerId: opts.reviewerId,
      provider: opts.provider,
    } satisfies FindingDetectPayload);

    this.store.append(event);

    try {
      this.store.commitTransaction([], [{
        entityType: "finding",
        entityId: id,
        toState: "open",
        source: opts.provider,
        metadata: {
          severity: opts.reply.severity,
          category: opts.reply.category,
          description: opts.reply.description,
          file: opts.reply.file,
          line: opts.reply.line,
          reviewerId: opts.reviewerId,
          replyTo: opts.parentId,
        },
      }], []);
    } catch (err) { console.warn(`[message-bus] replyToFinding state transition failed: ${(err as Error).message}`); }

    this._invalidate();
    return id;
  }

  /**
   * Get a threaded conversation for a finding.
   * Returns the root finding + all replies + timeline of ack/resolve actions.
   */
  getThread(findingId: string): FindingThread | null {
    const allFindings = this._rawFindings();

    // Find the root: walk up replyTo chain
    let rootId = findingId;
    for (let i = 0; i < 10; i++) { // max depth guard
      const current = allFindings.find(f => f.id === rootId);
      if (!current?.replyTo) break;
      rootId = current.replyTo;
    }

    const root = allFindings.find(f => f.id === rootId);
    if (!root) return null;

    // Collect all replies (direct + nested)
    const replies: Finding[] = [];
    const collectReplies = (parentId: string) => {
      for (const f of allFindings) {
        if (f.replyTo === parentId) {
          replies.push(f);
          collectReplies(f.id);
        }
      }
    };
    collectReplies(rootId);

    // Build timeline from ack/resolve events for all findings in thread
    const threadIds = new Set([rootId, ...replies.map(r => r.id)]);
    const timeline: FindingThread["timeline"] = [];

    for (const e of this._ackEvents()) {
      const p = e.payload as unknown as FindingAckPayload;
      if (threadIds.has(p.findingId)) {
        timeline.push({
          action: `ack:${p.action}`,
          timestamp: e.timestamp,
          source: e.source,
        });
      }
    }
    for (const e of this._resolveEvents()) {
      const p = e.payload as unknown as FindingResolvePayload;
      if (threadIds.has(p.findingId)) {
        timeline.push({
          action: `resolve:${p.resolution}`,
          timestamp: e.timestamp,
          source: e.source,
        });
      }
    }

    // Add finding submissions as timeline entries
    for (const e of this._detectEvents()) {
      const p = e.payload as unknown as FindingDetectPayload;
      if (!p.findings) continue;
      for (const f of p.findings) {
        if (threadIds.has(f.id)) {
          timeline.push({
            action: f.replyTo ? "reply" : "detect",
            timestamp: e.timestamp,
            source: e.source,
            reviewerId: p.reviewerId,
          });
        }
      }
    }

    timeline.sort((a, b) => a.timestamp - b.timestamp);

    return { root, replies, timeline };
  }

  /**
   * Get all threads grouped by file. Used by daemon chat view.
   * Returns only root findings (with reply counts), sorted by file then time.
   */
  getThreadsByFile(): Map<string, FindingThread[]> {
    const allFindings = this._rawFindings();
    const closedIds = this.getClosedFindingIds();

    // Build indexes once — avoids O(R×N) re-scanning
    const repliesByParent = new Map<string, Finding[]>();
    const roots: Finding[] = [];

    for (const f of allFindings) {
      if (f.replyTo) {
        const arr = repliesByParent.get(f.replyTo) ?? [];
        arr.push(f);
        repliesByParent.set(f.replyTo, arr);
      } else {
        roots.push(f);
      }
    }

    // Pre-index ack/resolve/detect events by findingId — O(E) once instead of O(R×E)
    const ackByFinding = this._indexByFindingId(
      this._ackEvents(), p => (p as unknown as FindingAckPayload).findingId,
    );
    const resolveByFinding = this._indexByFindingId(
      this._resolveEvents(), p => (p as unknown as FindingResolvePayload).findingId,
    );
    const detectByFinding = new Map<string, Array<{ event: QuorumEvent; finding: Finding; reviewerId: string }>>();
    for (const e of this._detectEvents()) {
      const p = e.payload as unknown as FindingDetectPayload;
      if (!p.findings) continue;
      for (const f of p.findings) {
        const arr = detectByFinding.get(f.id) ?? [];
        arr.push({ event: e, finding: f, reviewerId: p.reviewerId });
        detectByFinding.set(f.id, arr);
      }
    }

    const fileMap = new Map<string, FindingThread[]>();

    for (const root of roots) {
      // Collect replies recursively
      const replies: Finding[] = [];
      const collectReplies = (parentId: string) => {
        for (const r of repliesByParent.get(parentId) ?? []) {
          replies.push(r);
          collectReplies(r.id);
        }
      };
      collectReplies(root.id);

      // Skip fully resolved threads
      const allIds = new Set([root.id, ...replies.map(r => r.id)]);
      if ([...allIds].every(id => closedIds.has(id))) continue;

      // Build timeline from pre-indexed events — O(threadSize) per root
      const timeline = this._buildTimeline(allIds, ackByFinding, resolveByFinding, detectByFinding);

      const file = root.file ?? "(no file)";
      const threads = fileMap.get(file) ?? [];
      threads.push({ root, replies, timeline });
      fileMap.set(file, threads);
    }

    return fileMap;
  }

  /**
   * Get all open (unresolved) findings with read-time dedup applied.
   * Duplicate findings (same file+line+category) are merged with detectedBy[].
   */
  getOpenFindings(): Finding[] {
    return this._collectAndDedup();
  }

  // ── Progressive Disclosure (3-layer) ───────

  /**
   * Layer 1: Lightweight search — returns ID + severity + dedup info only.
   * Token-efficient for agents that only need to scan what's open.
   */
  searchFindings(filter?: {
    file?: string;
    category?: string;
    severity?: FindingSeverity;
    status?: FindingStatus;
  }): FindingSummary[] {
    const deduped = this._collectAndDedup();
    let results = deduped;

    if (filter?.file) {
      results = results.filter(f => f.file === filter.file);
    }
    if (filter?.category) {
      results = results.filter(f => f.category === filter.category);
    }
    if (filter?.severity) {
      results = results.filter(f => f.severity === filter.severity);
    }
    if (filter?.status) {
      results = results.filter(f => f.status === filter.status);
    }

    return results.map(f => this._toSummary(f));
  }

  /**
   * Layer 2: Context — description + nearby findings + timeline.
   * For agents that need to understand a specific finding in context.
   */
  getFindingContext(findingId: string): FindingContext | null {
    const deduped = this._collectAndDedup();
    const target = deduped.find(f => f.id === findingId);
    if (!target) return null;

    // Nearby: other findings in the same file
    const nearby: FindingSummary[] = target.file
      ? deduped
          .filter(f => f.id !== findingId && f.file === target.file)
          .map(f => this._toSummary(f))
      : [];

    const timeline = this._findingTimeline(findingId);

    return {
      ...this._toSummary(target),
      description: target.description,
      provider: target.provider,
      nearbyFindings: nearby,
      timeline,
    };
  }

  /**
   * Layer 3: Full detail — suggestion + per-reviewer breakdown.
   * For agents that need the complete picture to act on a finding.
   */
  getFindingDetail(findingId: string): FindingDetail | null {
    const context = this.getFindingContext(findingId);
    if (!context) return null;

    // Gather per-reviewer details from _rawFindings cache
    const raw = this._rawFindings();
    const reviewerDetails: FindingDetail["reviewerDetails"] = [];
    for (const f of raw) {
      if (this._dedupKey(f) === this._dedupKey(context as unknown as Finding)) {
        reviewerDetails.push({
          reviewerId: f.reviewerId,
          provider: f.provider,
          description: f.description,
        });
      }
    }

    // Find suggestion from any reviewer's version
    let suggestion: string | undefined;
    for (const f of raw) {
      if (f.id === findingId && f.suggestion) {
        suggestion = f.suggestion;
        break;
      }
    }
    // Fallback: check merged findings for suggestion
    if (!suggestion) {
      for (const f of raw) {
        if (this._dedupKey(f) === this._dedupKey(context as unknown as Finding) && f.suggestion) {
          suggestion = f.suggestion;
          break;
        }
      }
    }

    return {
      ...context,
      suggestion,
      reviewerDetails,
    };
  }

  // ── Private: Dedup + Collection ─────────────

  /** Dedup key for a finding: file:line:category */
  private _dedupKey(f: { file?: string; line?: number; category: string }): string {
    return `${f.file ?? ""}:${f.line ?? ""}:${f.category}`;
  }

  /**
   * Collect all findings from events, apply read-time dedup.
   * Returns deduplicated findings with detectedBy and consensusScore.
   */
  private _collectAndDedup(): Finding[] {
    const raw = this._rawFindings();
    const closedIds = this.getClosedFindingIds();

    // Group by dedup key; count distinct providers across all raw findings for score denominator
    const groups = new Map<string, Finding[]>();
    const allProviders = new Set<string>();
    for (const f of raw) {
      allProviders.add(f.provider);
      if (closedIds.has(f.id)) continue;
      if (f.replyTo) continue;
      const key = this._dedupKey(f);
      const group = groups.get(key);
      if (group) group.push(f);
      else groups.set(key, [f]);
    }
    const totalProviders = Math.max(allProviders.size, 1);

    // Merge each group into a single finding
    const results: Finding[] = [];
    for (const [, group] of groups) {
      const primary = group[0]!;
      const detectedBy = [...new Set(group.map(f => f.reviewerId))];
      const consensusScore = detectedBy.length / totalProviders;

      // Use highest severity from the group
      let maxSeverity = primary.severity;
      for (const f of group) {
        if (SEVERITY_RANK[f.severity] > SEVERITY_RANK[maxSeverity]) {
          maxSeverity = f.severity;
        }
      }

      results.push({
        ...primary,
        severity: maxSeverity,
        detectedBy,
        consensusScore,
      });
    }

    return results;
  }

  /** Collect raw (non-deduped) findings from all detect events. Cached until invalidated. */
  private _rawFindings(): Finding[] {
    if (this._cache.raw) return this._cache.raw;
    const findings: Finding[] = [];
    for (const event of this._detectEvents()) {
      const payload = event.payload as unknown as FindingDetectPayload;
      if (payload.findings) findings.push(...payload.findings);
    }
    this._cache.raw = findings;
    return findings;
  }

  /** Lazy-load and cache events by type. Invalidated on writes via _invalidate(). */
  private _cachedEvents(slot: "detects" | "acks" | "resolves", eventType: EventType): QuorumEvent[] {
    if (!this._cache[slot]) this._cache[slot] = this.store.query({ eventType });
    return this._cache[slot]!;
  }
  private _detectEvents() { return this._cachedEvents("detects", "finding.detect"); }
  private _ackEvents() { return this._cachedEvents("acks", "finding.ack"); }
  private _resolveEvents() { return this._cachedEvents("resolves", "finding.resolve"); }

  /** Build set of closed finding IDs from ack (dismiss) + resolve events. Cached until invalidated. */
  getClosedFindingIds(): Set<string> {
    if (this._cache.closed) return this._cache.closed;
    const closed = new Set<string>();
    for (const e of this._ackEvents()) {
      const p = e.payload as unknown as FindingAckPayload;
      if (p.action === "dismiss") closed.add(p.findingId);
    }
    for (const e of this._resolveEvents()) {
      const p = e.payload as unknown as FindingResolvePayload;
      closed.add(p.findingId);
    }
    this._cache.closed = closed;
    return closed;
  }

  /** Build timeline of ack/resolve actions for a specific finding. */
  private _findingTimeline(findingId: string): FindingContext["timeline"] {
    const timeline: FindingContext["timeline"] = [];
    for (const e of this._ackEvents()) {
      const p = e.payload as unknown as FindingAckPayload;
      if (p.findingId === findingId) {
        timeline.push({ action: `ack:${p.action}`, timestamp: e.timestamp, source: e.source });
      }
    }
    for (const e of this._resolveEvents()) {
      const p = e.payload as unknown as FindingResolvePayload;
      if (p.findingId === findingId) {
        timeline.push({ action: `resolve:${p.resolution}`, timestamp: e.timestamp, source: e.source });
      }
    }
    return timeline.sort((a, b) => a.timestamp - b.timestamp);
  }

  /** Index events by findingId extracted via `keyFn`. Used by getThreadsByFile(). */
  private _indexByFindingId(
    events: QuorumEvent[],
    keyFn: (payload: Record<string, unknown>) => string,
  ): Map<string, QuorumEvent[]> {
    const idx = new Map<string, QuorumEvent[]>();
    for (const e of events) {
      const fid = keyFn(e.payload);
      const arr = idx.get(fid) ?? [];
      arr.push(e);
      idx.set(fid, arr);
    }
    return idx;
  }

  /** Build timeline entries for a set of finding IDs from pre-indexed events. */
  private _buildTimeline(
    ids: Set<string>,
    ackIdx: Map<string, QuorumEvent[]>,
    resolveIdx: Map<string, QuorumEvent[]>,
    detectIdx: Map<string, Array<{ event: QuorumEvent; finding: Finding; reviewerId: string }>>,
  ): FindingThread["timeline"] {
    const timeline: FindingThread["timeline"] = [];
    for (const id of ids) {
      for (const e of ackIdx.get(id) ?? []) {
        const p = e.payload as unknown as FindingAckPayload;
        timeline.push({ action: `ack:${p.action}`, timestamp: e.timestamp, source: e.source });
      }
      for (const e of resolveIdx.get(id) ?? []) {
        const p = e.payload as unknown as FindingResolvePayload;
        timeline.push({ action: `resolve:${p.resolution}`, timestamp: e.timestamp, source: e.source });
      }
      for (const d of detectIdx.get(id) ?? []) {
        timeline.push({
          action: d.finding.replyTo ? "reply" : "detect",
          timestamp: d.event.timestamp, source: d.event.source, reviewerId: d.reviewerId,
        });
      }
    }
    return timeline.sort((a, b) => a.timestamp - b.timestamp);
  }

  /** Convert a Finding to a lightweight FindingSummary. */
  private _toSummary(f: Finding): FindingSummary {
    return {
      id: f.id, severity: f.severity, category: f.category,
      file: f.file, line: f.line, status: f.status,
      detectedBy: f.detectedBy ?? [], consensusScore: f.consensusScore ?? 0,
    };
  }

  /**
   * Get finding statistics.
   */
  getStats(): { total: number; open: number; confirmed: number; dismissed: number; fixed: number } {
    // Track per-finding final state to avoid double-counting
    // (e.g. ack:dismiss + resolve:dismissed on same finding)
    const findingState = new Map<string, "open" | "confirmed" | "dismissed" | "fixed" | "superseded">();

    let total = 0;
    for (const f of this._rawFindings()) {
      findingState.set(f.id, "open");
      total++;
    }

    for (const e of this._ackEvents()) {
      const p = e.payload as unknown as FindingAckPayload;
      if (p.action === "dismiss") findingState.set(p.findingId, "dismissed");
      else findingState.set(p.findingId, "confirmed");
    }
    for (const e of this._resolveEvents()) {
      const p = e.payload as unknown as FindingResolvePayload;
      findingState.set(p.findingId, p.resolution === "fixed" ? "fixed"
        : p.resolution === "superseded" ? "superseded" : "dismissed");
    }

    let open = 0, confirmed = 0, dismissed = 0, fixed = 0;
    for (const state of findingState.values()) {
      if (state === "open") open++;
      else if (state === "confirmed") confirmed++;
      else if (state === "dismissed" || state === "superseded") dismissed++;
      else if (state === "fixed") fixed++;
    }

    return { total, open, confirmed, dismissed, fixed };
  }

  // ── Context Revival ───────────────────────────

  /**
   * Save context summary for revival. Called when agent context is nearing limit.
   * Captures: open findings, verdict history, pending work items.
   */
  saveContext(
    sessionId: string,
    agentId: string,
    pendingItems: string[],
    round: number,
    source: ProviderKind = "claude-code",
  ): void {
    const stats = this.getStats();
    const openFindings = this.getOpenFindings();

    // Build compact summary
    const summaryParts: string[] = [
      `Round ${round} context save.`,
      `Findings: ${stats.total} total, ${stats.open} open, ${stats.fixed} fixed.`,
    ];
    if (openFindings.length > 0) {
      summaryParts.push("Open issues:");
      for (const f of openFindings.slice(0, 10)) {
        summaryParts.push(`  - [${f.severity}] ${f.category}: ${f.description.slice(0, 80)}`);
      }
    }
    if (pendingItems.length > 0) {
      summaryParts.push(`Pending items: ${pendingItems.join(", ")}`);
    }

    const summary = summaryParts.join("\n");
    const payload: ContextSavePayload = {
      sessionId,
      agentId,
      summary,
      findingCount: stats.total,
      pendingItems,
      round,
    };

    this.store.append(createEvent("context.save", source, payload as unknown as Record<string, unknown>));

    // Also store in KV for quick retrieval
    this.store.setKV(`context:revival:${agentId}`, {
      sessionId,
      summary,
      savedAt: Date.now(),
      round,
      openFindings: openFindings.slice(0, 10).map(f => ({
        id: f.id, severity: f.severity, category: f.category, description: f.description.slice(0, 100),
      })),
      pendingItems,
    });
  }

  /**
   * Restore context from a previous session. Returns null if no saved context.
   */
  restoreContext(agentId: string): {
    summary: string;
    savedAt: number;
    round: number;
    openFindings: Array<{ id: string; severity: string; category: string; description: string }>;
    pendingItems: string[];
  } | null {
    const saved = this.store.getKV(`context:revival:${agentId}`);
    if (!saved || typeof saved !== "object") return null;
    return saved as ReturnType<MessageBus["restoreContext"]>;
  }

  // ── Agent-to-Agent Sync Queries ───────────────

  /**
   * Post a query to another agent (or broadcast). Returns the queryId.
   *
   * Accepts either an options object or positional args (legacy).
   */
  postQuery(opts: PostQueryOpts): string;
  postQuery(fromAgent: string, question: string, source?: ProviderKind, toAgent?: string, context?: Record<string, unknown>): string;
  postQuery(
    fromAgentOrOpts: string | PostQueryOpts,
    question?: string,
    source?: ProviderKind,
    toAgent?: string,
    context?: Record<string, unknown>,
  ): string {
    const opts = typeof fromAgentOrOpts === "string"
      ? { fromAgent: fromAgentOrOpts, question: question!, source, toAgent, context }
      : fromAgentOrOpts;
    const src = opts.source ?? "claude-code";
    const queryId = `Q-${randomUUID().slice(0, 8)}`;
    const payload: AgentQueryPayload = { queryId, fromAgent: opts.fromAgent, toAgent: opts.toAgent, question: opts.question, context: opts.context };
    this.store.append(createEvent("agent.query", src, payload as unknown as Record<string, unknown>));
    return queryId;
  }

  /**
   * Respond to a query. Links response to original query via queryId.
   *
   * Accepts either an options object or positional args (legacy).
   */
  respondToQuery(opts: RespondToQueryOpts): void;
  respondToQuery(queryId: string, fromAgent: string, answer: string, source?: ProviderKind, confidence?: number): void;
  respondToQuery(
    queryIdOrOpts: string | RespondToQueryOpts,
    fromAgent?: string,
    answer?: string,
    source?: ProviderKind,
    confidence?: number,
  ): void {
    const opts = typeof queryIdOrOpts === "string"
      ? { queryId: queryIdOrOpts, fromAgent: fromAgent!, answer: answer!, source, confidence }
      : queryIdOrOpts;
    const src = opts.source ?? "claude-code";
    const payload: AgentResponsePayload = { queryId: opts.queryId, fromAgent: opts.fromAgent, answer: opts.answer, confidence: opts.confidence };
    this.store.append(createEvent("agent.response", src, payload as unknown as Record<string, unknown>));
  }

  /**
   * Poll for queries addressed to a specific agent (or broadcast queries).
   * Returns queries that haven't been responded to by this agent yet.
   *
   * @param since - Only return queries after this timestamp. Defaults to 5 minutes ago
   *   to avoid scanning the entire event history on each poll. Pass 0 explicitly for full scan.
   */
  pollQueries(agentId: string, since?: number): Array<AgentQueryPayload & { timestamp: number }> {
    if (since === undefined) since = Date.now() - 300_000;
    const queries = this.store.query({ eventType: "agent.query", since });
    const responses = this.store.query({ eventType: "agent.response", since });

    // Build set of queryIds already answered by this agent
    const answered = new Set<string>();
    for (const e of responses) {
      const p = e.payload as unknown as AgentResponsePayload;
      if (p.fromAgent === agentId) answered.add(p.queryId);
    }

    const pending: Array<AgentQueryPayload & { timestamp: number }> = [];
    for (const e of queries) {
      const p = e.payload as unknown as AgentQueryPayload;
      // Skip own queries, skip already answered
      if (p.fromAgent === agentId) continue;
      if (answered.has(p.queryId)) continue;
      // Include if addressed to this agent or broadcast
      if (!p.toAgent || p.toAgent === agentId) {
        pending.push({ ...p, timestamp: e.timestamp });
      }
    }

    return pending;
  }

  /**
   * Get responses to a specific query. Used by the querying agent to check answers.
   */
  getResponses(queryId: string): Array<AgentResponsePayload & { timestamp: number }> {
    const events = this.store.query({ eventType: "agent.response" });
    const results: Array<AgentResponsePayload & { timestamp: number }> = [];
    for (const e of events) {
      const p = e.payload as unknown as AgentResponsePayload;
      if (p.queryId === queryId) {
        results.push({ ...p, timestamp: e.timestamp });
      }
    }
    return results;
  }
}
