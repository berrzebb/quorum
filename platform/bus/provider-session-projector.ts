/**
 * Provider Session Projector — converts provider session state into
 * bus-readable format for daemon/TUI observability.
 *
 * Reads from SessionLedger and produces SessionProjection records
 * suitable for rendering in daemon panels (e.g., ProviderSessionPanel).
 *
 * This is a read-only projection layer — it does not mutate state.
 */

import type { SessionLedger } from "../providers/session-ledger.js";
import type { ProviderSessionRecord } from "../core/harness/provider-session-record.js";
import type { ProviderExecutionMode } from "../providers/session-runtime.js";

/**
 * Projected session state for daemon/TUI display.
 */
export interface SessionProjection {
  quorumSessionId: string;
  provider: "codex" | "claude";
  executionMode: ProviderExecutionMode;
  providerSessionId: string;
  threadId?: string;
  state: ProviderSessionRecord["state"];
  startedAt: number;
  updatedAt: number;
  age: number; // ms since start
  pendingApprovals: number;
}

/**
 * Projects provider session state for daemon/TUI consumption.
 */
export class ProviderSessionProjector {
  constructor(private readonly ledger: SessionLedger) {}

  /**
   * Project all active sessions.
   *
   * InMemorySessionLedger doesn't expose a listAll method,
   * so this returns an empty array. When a SQLite-backed ledger
   * is implemented with listAll(), this method can be wired up.
   */
  projectAll(): SessionProjection[] {
    // SessionLedger interface doesn't have listAll —
    // future SQLite implementation will expose it.
    return [];
  }

  /**
   * Project a single session by quorum session ID.
   */
  project(quorumSessionId: string): SessionProjection | null {
    const record = this.ledger.findByQuorumSession(quorumSessionId);
    if (!record) return null;
    return this.projectRecord(record);
  }

  /**
   * Project sessions by contract ID.
   */
  projectByContract(contractId: string): SessionProjection[] {
    const records = this.ledger.findByContract(contractId);
    return records
      .map((record) => this.projectRecord(record))
      .filter((p): p is SessionProjection => p !== null);
  }

  private projectRecord(record: ProviderSessionRecord): SessionProjection {
    const now = Date.now();
    return {
      quorumSessionId: record.quorumSessionId,
      provider: record.providerRef.provider,
      executionMode: record.providerRef.executionMode,
      providerSessionId: record.providerRef.providerSessionId,
      threadId: record.providerRef.threadId,
      state: record.state,
      startedAt: record.startedAt,
      updatedAt: record.updatedAt,
      age: now - record.startedAt,
      pendingApprovals: this.ledger.pendingApprovals(
        record.providerRef.providerSessionId
      ).length,
    };
  }
}

// ── RTI-1C: Transcript Workload Metrics ─────────────────

/**
 * Telemetry metrics for transcript workload measurement.
 * Used as baseline before search index introduction.
 * @since RTI-1C
 */
export interface TranscriptWorkloadMetrics {
  /** Session ID. */
  sessionId: string;
  /** Total event count in the session. */
  eventCount: number;
  /** Estimated visible text line count. */
  visibleLineCount: number;
  /** Timestamp of last event append. */
  lastAppendTs: number;
  /** Average events per minute (append cadence). */
  appendCadence: number;
}

/** Callback for transcript workload telemetry. */
export type TranscriptWorkloadCallback = (metrics: TranscriptWorkloadMetrics) => void;

const _transcriptWorkloadCallbacks: TranscriptWorkloadCallback[] = [];

/** Register a transcript workload telemetry callback. @since RTI-1C */
export function onTranscriptWorkload(cb: TranscriptWorkloadCallback): void {
  _transcriptWorkloadCallbacks.push(cb);
}

/**
 * Emit transcript workload metrics.
 * Called by daemon state reader or projector when transcript grows.
 * @since RTI-1C
 */
export function emitTranscriptWorkload(metrics: TranscriptWorkloadMetrics): void {
  for (const cb of _transcriptWorkloadCallbacks) {
    try { cb(metrics); } catch { /* telemetry must not break projector */ }
  }
}

// ── RTI-3C: Search State Projection ─────────────────

/**
 * Search state projected for daemon/UI consumption.
 * UI reads this instead of calling the index directly.
 * @since RTI-3C
 */
export interface SearchStateProjection {
  /** Whether a search is currently active. */
  active: boolean;
  /** Current search query (empty if no search). */
  query: string;
  /** Session scope of the search. */
  scope: "session" | "provider" | "global";
  /** Target session ID (for session-scoped search). */
  sessionId?: string;
  /** Search results. */
  hits: SearchHitProjection[];
  /** Index of the currently focused hit (-1 if none). */
  focusedHitIndex: number;
  /** Total indexed line count for the session. */
  indexedLineCount: number;
  /** Search latency in ms (for telemetry). */
  lastSearchMs?: number;
}

/** Projected search hit for UI. */
export interface SearchHitProjection {
  sessionId: string;
  line: number;
  excerpt: string;
  score: number;
  section?: string;
}

/**
 * Create an empty search state (no active search).
 * @since RTI-3C
 */
export function emptySearchState(): SearchStateProjection {
  return {
    active: false,
    query: "",
    scope: "session",
    hits: [],
    focusedHitIndex: -1,
    indexedLineCount: 0,
  };
}

/**
 * Create a search state from query results.
 * @since RTI-3C
 */
export function projectSearchState(
  query: string,
  scope: SearchStateProjection["scope"],
  hits: SearchHitProjection[],
  indexedLineCount: number,
  searchMs?: number,
  sessionId?: string,
): SearchStateProjection {
  return {
    active: query.length > 0,
    query,
    scope,
    sessionId,
    hits,
    focusedHitIndex: hits.length > 0 ? 0 : -1,
    indexedLineCount,
    lastSearchMs: searchMs,
  };
}

/**
 * Navigate to next hit in search state.
 * @since RTI-3C
 */
export function nextSearchHit(state: SearchStateProjection): SearchStateProjection {
  if (state.hits.length === 0) return state;
  return {
    ...state,
    focusedHitIndex: (state.focusedHitIndex + 1) % state.hits.length,
  };
}

/**
 * Navigate to previous hit in search state.
 * @since RTI-3C
 */
export function prevSearchHit(state: SearchStateProjection): SearchStateProjection {
  if (state.hits.length === 0) return state;
  return {
    ...state,
    focusedHitIndex: (state.focusedHitIndex - 1 + state.hits.length) % state.hits.length,
  };
}
