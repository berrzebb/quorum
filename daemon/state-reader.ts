/**
 * StateReader — reads all quorum state from SQLite exclusively.
 *
 * Replaces the file-scraping bootstrapFromFiles() approach.
 * The daemon TUI uses this to display current state without
 * parsing markdown files, JSON locks, or retro markers.
 *
 * All state is derived from:
 * - state_transitions table (item states, gate states)
 * - locks table (audit locks)
 * - kv_state table (retro markers, session IDs)
 * - events table (recent events, specialist reviews, track progress)
 */

import type Database from "better-sqlite3";
import type { EventStore } from "../bus/store.js";
import type { LockInfo } from "../bus/lock.js";
import { COMMITTEE_IDS } from "../bus/meeting-log.js";
import { getPendingAmendmentCount } from "../bus/amendment.js";
import type { Finding } from "../bus/events.js";
import type {
  QuorumEvent,
  FindingDetectPayload,
  FindingAckPayload,
  FindingResolvePayload,
  ReviewProgressPayload,
} from "../bus/events.js";
import type { MessageBus } from "../bus/message-bus.js";

// ── Types ────────────────────────────────────

export interface GateInfo {
  name: string;
  status: "open" | "blocked" | "pending" | "error";
  detail?: string;
  since?: number;
}

export interface ItemStateInfo {
  entityId: string;
  currentState: string;
  source: string;
  label?: string;
  updatedAt: number;
}

export interface SpecialistInfo {
  domain: string;
  tool?: string;
  toolStatus?: string;
  agent?: string;
  agentVerdict?: string;
  timestamp: number;
}

export interface TrackInfo {
  trackId: string;
  total: number;
  completed: number;
  pending: number;
  blocked: number;
  lastUpdate: number;
}

export interface FindingInfo {
  id: string;
  severity: string;
  file?: string;
  line?: number;
  description: string;
  category: string;
  reviewerId: string;
  provider: string;
  timestamp: number;
}

export interface FindingStats {
  total: number;
  open: number;
  confirmed: number;
  dismissed: number;
  fixed: number;
}

export interface ReviewProgressInfo {
  reviewerId: string;
  provider: string;
  progress: number;
  phase: string;
  timestamp: number;
}

/** A single message in a review thread (finding, reply, or action). */
export interface ThreadMessage {
  type: "finding" | "reply" | "ack" | "resolve";
  id?: string;
  reviewerId: string;
  provider: string;
  severity?: string;
  description: string;
  timestamp: number;
}

/** A review thread grouped by file. */
export interface FileThread {
  file: string;
  threads: Array<{
    rootId: string;
    category: string;
    messages: ThreadMessage[];
    open: boolean;
  }>;
}

export interface FitnessInfo {
  /** Current baseline score (null if not yet established). */
  baseline: number | null;
  /** Latest computed score (null if no fitness events yet). */
  current: number | null;
  /** Latest gate decision. */
  gate: {
    decision: "proceed" | "self-correct" | "auto-reject";
    delta: number;
    reason: string;
  } | null;
  /** Score history (newest last, up to 50 entries). */
  history: number[];
  /** Trend: moving average and slope. */
  trend: {
    movingAverage: number;
    slope: number;
  } | null;
  /** Component breakdown of the latest score. */
  components: Record<string, { value: number; weight: number; label: string }> | null;
}

export interface ParliamentCommitteeStatus {
  committee: string;
  converged: boolean;
  stableRounds: number;
  threshold: number;
  score: number;
}

export interface ParliamentInfo {
  /** Per-committee convergence status. */
  committees: ParliamentCommitteeStatus[];
  /** Latest session verdict. */
  lastVerdict: string | null;
  /** Number of pending (unresolved) amendments. */
  pendingAmendments: number;
  /** Normal Form conformance (0-1). */
  conformance: number | null;
  /** Total parliament sessions recorded. */
  sessionCount: number;
}

export interface FullState {
  gates: GateInfo[];
  items: ItemStateInfo[];
  locks: LockInfo[];
  specialists: SpecialistInfo[];
  tracks: TrackInfo[];
  findings: FindingInfo[];
  findingStats: FindingStats;
  reviewProgress: ReviewProgressInfo[];
  fileThreads: FileThread[];
  recentEvents: QuorumEvent[];
  fitness: FitnessInfo;
  parliament: ParliamentInfo;
}

// ── StateReader ──────────────────────────────

export class StateReader {
  private store: EventStore;
  private messageBus: MessageBus | null;
  private stmtItemStates: Database.Statement;
  private stmtActiveLocks: Database.Statement;
  private stmtLatestTransition: Database.Statement;

  constructor(store: EventStore, messageBus?: MessageBus | null) {
    this.store = store;
    this.messageBus = messageBus ?? null;
    const db = store.getDb();
    this.stmtItemStates = db.prepare(`
      SELECT entity_id, to_state, source, metadata, created_at
      FROM state_transitions st1
      WHERE entity_type = 'audit_item'
        AND rowid = (
          SELECT rowid FROM state_transitions st2
          WHERE st2.entity_type = st1.entity_type
            AND st2.entity_id = st1.entity_id
          ORDER BY st2.created_at DESC, st2.rowid DESC
          LIMIT 1
        )
      ORDER BY created_at DESC
    `);
    this.stmtActiveLocks = db.prepare(
      `SELECT * FROM locks WHERE acquired_at + ttl_ms > ?`
    );
    this.stmtLatestTransition = db.prepare(`
      SELECT to_state, created_at FROM state_transitions
      WHERE entity_type = ? AND entity_id = ?
      ORDER BY created_at DESC, rowid DESC
      LIMIT 1
    `);
  }

  /**
   * Read all state in one call — efficient for TUI polling.
   */
  readAll(eventLimit = 20): FullState {
    return {
      gates: this.gateStatus(),
      items: this.itemStates(),
      locks: this.activeLocks(),
      specialists: this.activeSpecialists(),
      tracks: this.trackProgress(),
      findings: this.openFindings(),
      findingStats: this.findingStats(),
      reviewProgress: this.reviewProgress(),
      fileThreads: this.findingThreads(),
      recentEvents: this.recentEvents(eventLimit),
      fitness: this.fitnessInfo(),
      parliament: this.parliamentInfo(),
    };
  }

  /**
   * 3 enforcement gates derived from SQLite state.
   */
  gateStatus(): GateInfo[] {
    const gates: GateInfo[] = [];

    // Audit gate: latest gate transition
    const auditState = this.latestTransition("gate", "audit");
    gates.push({
      name: "Audit",
      status: auditState
        ? (auditState.to_state === "approved" ? "open"
          : auditState.to_state === "pending" ? "pending"
          : auditState.to_state === "infra_failure" ? "error"
          : "blocked")
        : "open",
      detail: auditState?.to_state,
      since: auditState?.created_at,
    });

    // Retro gate: from kv_state
    const retroMarker = this.store.getKV("retro:marker") as { retro_pending?: boolean; completed_at?: string } | null;
    gates.push({
      name: "Retro",
      status: retroMarker?.retro_pending ? "blocked" : "open",
      detail: retroMarker?.retro_pending ? "retrospective pending" : undefined,
    });

    // Quality gate: recent quality.fail events in last 5 minutes
    const fiveMinAgo = Date.now() - 300_000;
    const qualityFails = this.store.count({
      eventType: "quality.fail",
      since: fiveMinAgo,
    });
    gates.push({
      name: "Quality",
      status: qualityFails > 0 ? "blocked" : "open",
      detail: qualityFails > 0 ? `${qualityFails} recent failure(s)` : undefined,
    });

    return gates;
  }

  /**
   * Current state of every tracked audit item.
   */
  itemStates(): ItemStateInfo[] {
    try {
      const rows = this.stmtItemStates.all() as Array<{
        entity_id: string;
        to_state: string;
        source: string;
        metadata: string;
        created_at: number;
      }>;

      return rows.map(r => {
        const meta = JSON.parse(r.metadata);
        return {
          entityId: r.entity_id,
          currentState: r.to_state,
          source: r.source,
          label: meta.label as string | undefined,
          updatedAt: r.created_at,
        };
      });
    } catch {
      return [];
    }
  }

  /**
   * Active (non-expired) locks.
   */
  activeLocks(): LockInfo[] {
    try {
      const rows = this.stmtActiveLocks.all(Date.now()) as Array<{
        lock_name: string;
        owner_pid: number;
        owner_session: string | null;
        acquired_at: number;
        ttl_ms: number;
      }>;

      return rows.map(r => ({
        held: true,
        lockName: r.lock_name,
        owner: r.owner_pid,
        ownerSession: r.owner_session ?? undefined,
        acquiredAt: r.acquired_at,
        ttlMs: r.ttl_ms,
      }));
    } catch {
      return [];
    }
  }

  /**
   * Active specialist domain reviews from recent events.
   */
  activeSpecialists(): SpecialistInfo[] {
    try {
      const specialists: SpecialistInfo[] = [];
      const recentTool = this.store.query({
        eventType: "specialist.tool",
        limit: 20,
      });
      const recentReview = this.store.query({
        eventType: "specialist.review",
        limit: 20,
      });

      // Build a map of domain → latest info
      const domainMap = new Map<string, SpecialistInfo>();

      for (const evt of recentTool) {
        const p = evt.payload;
        const domain = p.domain as string;
        domainMap.set(domain, {
          domain,
          tool: p.tool as string,
          toolStatus: p.status as string,
          timestamp: evt.timestamp,
        });
      }

      for (const evt of recentReview) {
        const p = evt.payload;
        const domain = p.domain as string;
        const existing = domainMap.get(domain);
        if (existing) {
          existing.agent = p.agent as string;
          existing.agentVerdict = p.verdict as string;
          existing.timestamp = Math.max(existing.timestamp, evt.timestamp);
        } else {
          domainMap.set(domain, {
            domain,
            agent: p.agent as string,
            agentVerdict: p.verdict as string,
            timestamp: evt.timestamp,
          });
        }
      }

      return [...domainMap.values()].sort((a, b) => b.timestamp - a.timestamp);
    } catch {
      return [];
    }
  }

  /**
   * Track progress from track.progress events.
   */
  trackProgress(): TrackInfo[] {
    try {
      const trackEvents = this.store.query({
        eventType: "track.progress",
        limit: 100,
      });

      // Latest per track
      const trackMap = new Map<string, TrackInfo>();
      for (const evt of trackEvents) {
        const p = evt.payload;
        const trackId = (p.trackId ?? evt.trackId ?? "unknown") as string;
        trackMap.set(trackId, {
          trackId,
          total: (p.total ?? 0) as number,
          completed: (p.completed ?? 0) as number,
          pending: (p.pending ?? 0) as number,
          blocked: (p.blocked ?? 0) as number,
          lastUpdate: evt.timestamp,
        });
      }

      return [...trackMap.values()].sort((a, b) => b.lastUpdate - a.lastUpdate);
    } catch {
      return [];
    }
  }

  /**
   * Open findings — detected but not yet dismissed or resolved.
   * Delegates to MessageBus when available (uses its cache + dedup logic).
   */
  openFindings(): FindingInfo[] {
    try {
      if (this.messageBus) {
        const open = this.messageBus.getOpenFindings();
        return open.map(f => ({
          id: f.id,
          severity: f.severity,
          file: f.file,
          line: f.line,
          description: f.description,
          category: f.category,
          reviewerId: f.reviewerId,
          provider: f.provider,
          timestamp: 0,
        }));
      }
      return this._openFindingsFallback();
    } catch {
      return [];
    }
  }

  /** Fallback when MessageBus is not injected. */
  private _openFindingsFallback(): FindingInfo[] {
    const detectEvents = this.store.query({ eventType: "finding.detect" });
    const ackEvents = this.store.query({ eventType: "finding.ack" });
    const resolveEvents = this.store.query({ eventType: "finding.resolve" });

    const closedIds = new Set<string>();
    for (const e of ackEvents) {
      const p = e.payload as unknown as FindingAckPayload;
      if (p.action === "dismiss") closedIds.add(p.findingId);
    }
    for (const e of resolveEvents) {
      const p = e.payload as unknown as FindingResolvePayload;
      closedIds.add(p.findingId);
    }

    const findings: FindingInfo[] = [];
    for (const evt of detectEvents) {
      const p = evt.payload as unknown as FindingDetectPayload;
      if (!p.findings) continue;
      for (const f of p.findings) {
        if (!closedIds.has(f.id)) {
          findings.push({
            id: f.id, severity: f.severity, file: f.file, line: f.line,
            description: f.description, category: f.category,
            reviewerId: p.reviewerId ?? f.reviewerId,
            provider: p.provider ?? f.provider,
            timestamp: evt.timestamp,
          });
        }
      }
    }
    return findings.sort((a, b) => b.timestamp - a.timestamp);
  }

  /**
   * Finding statistics — counts by status across all findings.
   * Delegates to MessageBus when available (single source of truth).
   */
  findingStats(): FindingStats {
    try {
      if (this.messageBus) {
        return this.messageBus.getStats();
      }
      return this._findingStatsFallback();
    } catch {
      return { total: 0, open: 0, confirmed: 0, dismissed: 0, fixed: 0 };
    }
  }

  private _findingStatsFallback(): FindingStats {
    const detectEvents = this.store.query({ eventType: "finding.detect" });
    const ackEvents = this.store.query({ eventType: "finding.ack" });
    const resolveEvents = this.store.query({ eventType: "finding.resolve" });

    const findingState = new Map<string, string>();
    let total = 0;
    for (const e of detectEvents) {
      const p = e.payload as unknown as FindingDetectPayload;
      if (!p.findings) continue;
      for (const f of p.findings) { findingState.set(f.id, "open"); total++; }
    }
    for (const e of ackEvents) {
      const p = e.payload as unknown as FindingAckPayload;
      findingState.set(p.findingId, p.action === "dismiss" ? "dismissed" : "confirmed");
    }
    for (const e of resolveEvents) {
      const p = e.payload as unknown as FindingResolvePayload;
      findingState.set(p.findingId, p.resolution === "fixed" ? "fixed" : "dismissed");
    }

    let open = 0, confirmed = 0, dismissed = 0, fixed = 0;
    for (const state of findingState.values()) {
      if (state === "open") open++;
      else if (state === "confirmed") confirmed++;
      else if (state === "dismissed") dismissed++;
      else if (state === "fixed") fixed++;
    }
    return { total, open, confirmed, dismissed, fixed };
  }

  /**
   * Review progress — latest progress per reviewer.
   */
  reviewProgress(): ReviewProgressInfo[] {
    try {
      const progressEvents = this.store.query({
        eventType: "review.progress",
        limit: 100,
      });

      // Latest per reviewer
      const reviewerMap = new Map<string, ReviewProgressInfo>();
      for (const evt of progressEvents) {
        const p = evt.payload as unknown as ReviewProgressPayload;
        const reviewerId = p.reviewerId ?? "unknown";
        reviewerMap.set(reviewerId, {
          reviewerId,
          provider: p.provider ?? "unknown",
          progress: p.progress ?? 0,
          phase: p.phase ?? "unknown",
          timestamp: evt.timestamp,
        });
      }

      return [...reviewerMap.values()].sort((a, b) => b.timestamp - a.timestamp);
    } catch {
      return [];
    }
  }

  /**
   * Review threads grouped by file — for chat view.
   * Delegates to MessageBus.getThreadsByFile() when available.
   */
  findingThreads(): FileThread[] {
    try {
      if (this.messageBus) {
        return this._threadsFromMessageBus();
      }
      return this._findingThreadsFallback();
    } catch {
      return [];
    }
  }

  /** Convert MessageBus.getThreadsByFile() → FileThread[] */
  private _threadsFromMessageBus(): FileThread[] {
    const mb = this.messageBus!;
    const byFile = mb.getThreadsByFile();

    const result: FileThread[] = [];
    for (const [file, threads] of byFile) {
      // getThreadsByFile() already filters out fully-closed threads, so open is always true
      const fileThreads: FileThread["threads"] = threads.map(t => {
        const messages: ThreadMessage[] = [];
        messages.push({
          type: "finding", id: t.root.id,
          reviewerId: t.root.reviewerId, provider: t.root.provider,
          severity: t.root.severity, description: t.root.description,
          timestamp: t.timeline.find(e => e.action === "detect")?.timestamp ?? 0,
        });
        for (const r of t.replies) {
          messages.push({
            type: "reply", id: r.id,
            reviewerId: r.reviewerId, provider: r.provider,
            severity: r.severity, description: r.description,
            timestamp: t.timeline.find(e => e.action === "reply" && e.reviewerId === r.reviewerId)?.timestamp ?? 0,
          });
        }
        for (const tl of t.timeline) {
          if (tl.action.startsWith("ack:") || tl.action.startsWith("resolve:")) {
            messages.push({
              type: tl.action.startsWith("ack:") ? "ack" : "resolve",
              reviewerId: tl.source, provider: tl.source,
              description: tl.action.split(":")[1] ?? "",
              timestamp: tl.timestamp,
            });
          }
        }
        messages.sort((a, b) => a.timestamp - b.timestamp);

        return { rootId: t.root.id, category: t.root.category, messages, open: true };
      });
      result.push({ file, threads: fileThreads });
    }
    return result.sort((a, b) => a.file.localeCompare(b.file));
  }

  /** Fallback when MessageBus is not injected. */
  private _findingThreadsFallback(): FileThread[] {
    const detectEvents = this.store.query({ eventType: "finding.detect" });
    const ackEvents = this.store.query({ eventType: "finding.ack" });
    const resolveEvents = this.store.query({ eventType: "finding.resolve" });

    const allFindings: Array<Finding & { timestamp: number }> = [];
    for (const evt of detectEvents) {
      const p = evt.payload as unknown as FindingDetectPayload;
      if (!p.findings) continue;
      for (const f of p.findings) allFindings.push({ ...f, timestamp: evt.timestamp });
    }

    const closedIds = new Set<string>();
    for (const e of ackEvents) {
      const p = e.payload as unknown as FindingAckPayload;
      if (p.action === "dismiss") closedIds.add(p.findingId);
    }
    for (const e of resolveEvents) {
      const p = e.payload as unknown as FindingResolvePayload;
      closedIds.add(p.findingId);
    }

    const actionMessages: ThreadMessage[] = [];
    for (const e of ackEvents) {
      const p = e.payload as unknown as FindingAckPayload;
      actionMessages.push({
        type: "ack", id: p.findingId, reviewerId: "author", provider: e.source,
        description: `${p.action}${p.reason ? `: ${p.reason}` : ""}`, timestamp: e.timestamp,
      });
    }
    for (const e of resolveEvents) {
      const p = e.payload as unknown as FindingResolvePayload;
      actionMessages.push({
        type: "resolve", id: p.findingId, reviewerId: "system", provider: e.source,
        description: p.resolution, timestamp: e.timestamp,
      });
    }

    const roots = allFindings.filter(f => !f.replyTo);
    const fileMap = new Map<string, FileThread["threads"]>();

    for (const root of roots) {
      const file = root.file ?? "(no file)";
      const replies = allFindings.filter(f => f.replyTo === root.id);
      const messages: ThreadMessage[] = [{
        type: "finding", id: root.id, reviewerId: root.reviewerId, provider: root.provider,
        severity: root.severity, description: root.description, timestamp: root.timestamp,
      }];
      for (const r of replies) {
        messages.push({
          type: "reply", id: r.id, reviewerId: r.reviewerId, provider: r.provider,
          severity: r.severity, description: r.description, timestamp: r.timestamp,
        });
      }
      const threadIds = new Set([root.id, ...replies.map(r => r.id)]);
      for (const am of actionMessages) {
        if (am.id && threadIds.has(am.id)) messages.push(am);
      }
      messages.sort((a, b) => a.timestamp - b.timestamp);
      const threads = fileMap.get(file) ?? [];
      threads.push({ rootId: root.id, category: root.category, messages, open: ![...threadIds].every(id => closedIds.has(id)) });
      fileMap.set(file, threads);
    }

    return [...fileMap.entries()]
      .map(([file, threads]) => ({ file, threads }))
      .sort((a, b) => a.file.localeCompare(b.file));
  }

  /**
   * Recent events for the audit stream.
   */
  recentEvents(limit = 20): QuorumEvent[] {
    return this.store.recent(limit);
  }

  /**
   * Fitness score data from EventStore KV + recent events.
   */
  fitnessInfo(): FitnessInfo {
    try {
      // Baseline and history from kv_state
      const baseline = this.store.getKV("fitness.baseline") as { total?: number; components?: Record<string, { value: number; weight: number; label: string }> } | null;
      const history = (this.store.getKV("fitness.history") as number[]) ?? [];

      // Latest gate decision from events
      const gateEvents = this.store.query({ eventType: "fitness.gate", limit: 1 });
      let gate: FitnessInfo["gate"] = null;
      if (gateEvents.length > 0) {
        const p = gateEvents[0].payload;
        gate = {
          decision: p.decision as "proceed" | "self-correct" | "auto-reject",
          delta: (p.delta as number) ?? 0,
          reason: (p.reason as string) ?? "",
        };
      }

      // Latest trend from events
      const trendEvents = this.store.query({ eventType: "fitness.trend", limit: 1 });
      let trend: FitnessInfo["trend"] = null;
      if (trendEvents.length > 0) {
        const p = trendEvents[0].payload;
        trend = {
          movingAverage: (p.movingAverage as number) ?? 0,
          slope: (p.slope as number) ?? 0,
        };
      }

      // Latest computed score from events
      const computeEvents = this.store.query({ eventType: "fitness.compute", limit: 1 });
      let current: number | null = null;
      let components: FitnessInfo["components"] = null;
      if (computeEvents.length > 0) {
        const score = computeEvents[0].payload.score as { total?: number; components?: Record<string, { value: number; weight: number; label: string }> } | undefined;
        if (score) {
          current = score.total ?? null;
          components = score.components ?? null;
        }
      }

      // If no compute events, use baseline for components
      if (!components && baseline?.components) {
        components = baseline.components;
      }

      return {
        baseline: baseline?.total ?? null,
        current: current ?? (history.length > 0 ? history[history.length - 1] : null),
        gate,
        history,
        trend,
        components,
      };
    } catch {
      return { baseline: null, current: null, gate: null, history: [], trend: null, components: null };
    }
  }

  /**
   * Changes since a timestamp — for incremental TUI updates.
   */
  changesSince(timestamp: number): {
    events: QuorumEvent[];
    hasStateChanges: boolean;
  } {
    const events = this.store.getEventsAfter(timestamp);
    const hasStateChanges = events.some(e =>
      e.type.startsWith("audit.") ||
      e.type.startsWith("retro.") ||
      e.type.startsWith("specialist.") ||
      e.type.startsWith("track.") ||
      e.type.startsWith("finding.") ||
      e.type === "review.progress",
    );
    return { events, hasStateChanges };
  }

  // ── Private helpers ──────────────────────

  private latestTransition(entityType: string, entityId: string): {
    to_state: string;
    created_at: number;
  } | null {
    try {
      return this.stmtLatestTransition.get(entityType, entityId) as { to_state: string; created_at: number } | undefined ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Parliament state: committee convergence, last verdict, pending amendments, conformance.
   */
  parliamentInfo(): ParliamentInfo {
    const empty: ParliamentInfo = {
      committees: COMMITTEE_IDS.map(c => ({ committee: c, converged: false, stableRounds: 0, threshold: 2, score: 0 })),
      lastVerdict: null, pendingAmendments: 0, conformance: null, sessionCount: 0,
    };

    try {
      // Session count + last verdict
      const sessions = this.store.query({ eventType: "parliament.session.digest" as import("../bus/events.js").EventType, limit: 100 });
      empty.sessionCount = sessions.length;

      if (sessions.length > 0) {
        const last = sessions[sessions.length - 1]!;
        empty.lastVerdict = (last.payload.summary as string) ?? null;
      }

      // Convergence per committee
      const convergenceEvents = this.store.query({ eventType: "parliament.convergence" as import("../bus/events.js").EventType, limit: 50 });
      const latestByCommittee = new Map<string, typeof convergenceEvents[0]>();
      for (const e of convergenceEvents) {
        const agenda = (e.payload.agendaId as string) ?? "";
        latestByCommittee.set(agenda, e);  // ASC order → last write = latest
      }
      empty.committees = COMMITTEE_IDS.map(c => {
        const e = latestByCommittee.get(c);
        if (!e) return { committee: c, converged: false, stableRounds: 0, threshold: 2, score: 0 };
        return {
          committee: c,
          converged: (e.payload.converged as boolean) ?? false,
          stableRounds: (e.payload.stableRounds as number) ?? 0,
          threshold: (e.payload.threshold as number) ?? 2,
          score: (e.payload.convergenceScore as number) ?? 0,
        };
      });

      // Pending amendments
      empty.pendingAmendments = getPendingAmendmentCount(this.store);

      // Conformance — reuse already-fetched sessions (last digest's conformance field)
      if (sessions.length > 0) {
        const lastSession = sessions[sessions.length - 1]!;
        const score = lastSession.payload.conformance as number | undefined;
        empty.conformance = typeof score === "number" ? score : null;
      }

      return empty;
    } catch {
      return empty;
    }
  }
}
