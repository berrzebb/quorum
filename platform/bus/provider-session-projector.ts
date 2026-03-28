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
