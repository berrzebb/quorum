/**
 * Finding queries — open findings, stats, review progress, file threads.
 */

import type { EventStore } from "../../../platform/bus/store.js";
import type { Finding } from "../../../platform/bus/events.js";
import type {
  FindingDetectPayload,
  FindingAckPayload,
  FindingResolvePayload,
  ReviewProgressPayload,
} from "../../../platform/bus/events.js";
import type { MessageBus } from "../../../platform/bus/message-bus.js";

// ── Types ────────────────────────────────────

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

// ── Queries ──────────────────────────────────

/**
 * Open findings — detected but not yet dismissed or resolved.
 * Delegates to MessageBus when available (uses its cache + dedup logic).
 */
export function queryOpenFindings(store: EventStore, messageBus?: MessageBus | null): FindingInfo[] {
  try {
    if (messageBus) {
      const open = messageBus.getOpenFindings();
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
    return openFindingsFallback(store);
  } catch {
    return [];
  }
}

/**
 * Finding statistics — counts by status across all findings.
 * Delegates to MessageBus when available (single source of truth).
 */
export function queryFindingStats(store: EventStore, messageBus?: MessageBus | null): FindingStats {
  try {
    if (messageBus) {
      return messageBus.getStats();
    }
    return findingStatsFallback(store);
  } catch {
    return { total: 0, open: 0, confirmed: 0, dismissed: 0, fixed: 0 };
  }
}

/**
 * Review progress — latest progress per reviewer.
 */
export function queryReviewProgress(store: EventStore): ReviewProgressInfo[] {
  try {
    const progressEvents = store.query({
      eventType: "review.progress",
      limit: 100,
      descending: true,
    });

    // First seen per reviewer (descending = newest first, so keep first occurrence)
    const reviewerMap = new Map<string, ReviewProgressInfo>();
    for (const evt of progressEvents) {
      const p = evt.payload as unknown as ReviewProgressPayload;
      const reviewerId = p.reviewerId ?? "unknown";
      if (reviewerMap.has(reviewerId)) continue;
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
export function queryFindingThreads(store: EventStore, messageBus?: MessageBus | null): FileThread[] {
  try {
    if (messageBus) {
      return threadsFromMessageBus(messageBus);
    }
    return findingThreadsFallback(store);
  } catch {
    return [];
  }
}

// ── Private helpers ──────────────────────────

/** Fetch finding events with time-bounded ack/resolve scoped to detect window. */
function fetchFindingEvents(store: EventStore) {
  const detectEvents = store.query({ eventType: "finding.detect", limit: 500, descending: true });
  if (detectEvents.length === 0) {
    return { detectEvents, ackEvents: [] as ReturnType<typeof store.query>, resolveEvents: [] as ReturnType<typeof store.query> };
  }
  const since = detectEvents[detectEvents.length - 1]!.timestamp;
  const ackEvents = store.query({ eventType: "finding.ack", since, limit: 1000 });
  const resolveEvents = store.query({ eventType: "finding.resolve", since, limit: 1000 });
  return { detectEvents, ackEvents, resolveEvents };
}

/** Fallback when MessageBus is not injected. */
function openFindingsFallback(store: EventStore): FindingInfo[] {
  const { detectEvents, ackEvents, resolveEvents } = fetchFindingEvents(store);

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

function findingStatsFallback(store: EventStore): FindingStats {
  const { detectEvents, ackEvents, resolveEvents } = fetchFindingEvents(store);

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

/** Convert MessageBus.getThreadsByFile() to FileThread[] */
function threadsFromMessageBus(messageBus: MessageBus): FileThread[] {
  const byFile = messageBus.getThreadsByFile();

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
function findingThreadsFallback(store: EventStore): FileThread[] {
  const { detectEvents, ackEvents, resolveEvents } = fetchFindingEvents(store);

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

  // Pre-index action messages by finding ID for O(1) lookup per thread
  const actionsByFindingId = new Map<string, ThreadMessage[]>();
  for (const am of actionMessages) {
    if (am.id) {
      const arr = actionsByFindingId.get(am.id) ?? [];
      arr.push(am);
      actionsByFindingId.set(am.id, arr);
    }
  }

  const roots = allFindings.filter(f => !f.replyTo);
  const replyMap = new Map<string, typeof allFindings>();
  for (const f of allFindings) {
    if (f.replyTo) {
      const arr = replyMap.get(f.replyTo) ?? [];
      arr.push(f);
      replyMap.set(f.replyTo, arr);
    }
  }
  const fileMap = new Map<string, FileThread["threads"]>();

  for (const root of roots) {
    const file = root.file ?? "(no file)";
    const replies = replyMap.get(root.id) ?? [];
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
    for (const id of threadIds) {
      const actions = actionsByFindingId.get(id);
      if (actions) messages.push(...actions);
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
