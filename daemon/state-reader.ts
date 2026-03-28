/**
 * StateReader — backward-compatible wrapper around SnapshotAssembler.
 *
 * All query logic has been extracted into daemon/state/queries/ modules.
 * SnapshotAssembler (daemon/state/snapshot.ts) orchestrates them.
 * This file delegates to SnapshotAssembler while preserving the original
 * StateReader class interface (used by daemon/app.tsx, daemon/index.ts, tests).
 *
 * All state is derived from:
 * - state_transitions table (item states, gate states)
 * - locks table (audit locks)
 * - kv_state table (retro markers, session IDs)
 * - events table (recent events, specialist reviews, track progress)
 */

import type { EventStore } from "../platform/bus/store.js";
import type { LockInfo } from "../platform/bus/lock.js";
import type { QuorumEvent } from "../platform/bus/events.js";
import type { MessageBus } from "../platform/bus/message-bus.js";

import { SnapshotAssembler } from "./state/snapshot.js";

import type {
  GateInfo,
  ItemStateInfo,
  SpecialistInfo,
  TrackInfo,
  FindingInfo,
  FindingStats,
  ReviewProgressInfo,
  ThreadMessage,
  FileThread,
  FitnessInfo,
  ParliamentCommitteeStatus,
  ParliamentLiveSession,
  ParliamentInfo,
  AgentQueryInfo,
  FullState,
} from "./state/snapshot.js";

import {
  queryGateStatus,
  queryOpenFindings,
  queryFindingStats,
  queryReviewProgress,
  queryFindingThreads,
  queryParliamentInfo,
  queryActiveSpecialists,
  queryAgentQueries,
  queryTrackProgress,
  queryItemStates,
  queryActiveLocks,
  queryFitnessInfo,
} from "./state/snapshot.js";

// ── Re-export all types for consumers ────────

export type {
  GateInfo,
  ItemStateInfo,
  SpecialistInfo,
  TrackInfo,
  FindingInfo,
  FindingStats,
  ReviewProgressInfo,
  ThreadMessage,
  FileThread,
  FitnessInfo,
  ParliamentCommitteeStatus,
  ParliamentLiveSession,
  ParliamentInfo,
  AgentQueryInfo,
  FullState,
};

// ── StateReader (backward-compatible wrapper) ─

export class StateReader {
  private assembler: SnapshotAssembler;
  private store: EventStore;
  private messageBus: MessageBus | null;
  private _liveSessionsCache: { ts: number; data: ParliamentLiveSession[] } = { ts: 0, data: [] };

  constructor(store: EventStore, messageBus?: MessageBus | null) {
    this.store = store;
    this.messageBus = messageBus ?? null;
    this.assembler = new SnapshotAssembler(store, messageBus);
  }

  /** Read all state in one call — efficient for TUI polling. */
  readAll(eventLimit = 20): FullState {
    return this.assembler.readAll(eventLimit);
  }

  /** 3 enforcement gates derived from SQLite state. */
  gateStatus(): GateInfo[] {
    return queryGateStatus(this.store);
  }

  /** Current state of every tracked audit item. */
  itemStates(): ItemStateInfo[] {
    return queryItemStates(this.store.getDb());
  }

  /** Active (non-expired) locks. */
  activeLocks(): LockInfo[] {
    return queryActiveLocks(this.store.getDb());
  }

  /** Active specialist domain reviews from recent events. */
  activeSpecialists(): SpecialistInfo[] {
    return queryActiveSpecialists(this.store);
  }

  /** Track progress from track.progress events. */
  trackProgress(): TrackInfo[] {
    return queryTrackProgress(this.store);
  }

  /** Open findings — detected but not yet dismissed or resolved. */
  openFindings(): FindingInfo[] {
    return queryOpenFindings(this.store, this.messageBus);
  }

  /** Finding statistics — counts by status across all findings. */
  findingStats(): FindingStats {
    return queryFindingStats(this.store, this.messageBus);
  }

  /** Review progress — latest progress per reviewer. */
  reviewProgress(): ReviewProgressInfo[] {
    return queryReviewProgress(this.store);
  }

  /** Review threads grouped by file — for chat view. */
  findingThreads(): FileThread[] {
    return queryFindingThreads(this.store, this.messageBus);
  }

  /** Recent events for the audit stream. */
  recentEvents(limit = 20): QuorumEvent[] {
    return this.store.recent(limit);
  }

  /** Fitness score data from EventStore KV + recent events. */
  fitnessInfo(): FitnessInfo {
    return queryFitnessInfo(this.store);
  }

  /** Parliament state: committee convergence, last verdict, pending amendments, conformance. */
  parliamentInfo(): ParliamentInfo {
    return queryParliamentInfo(this.store, this._liveSessionsCache);
  }

  /** Agent queries — recent inter-agent communication. */
  agentQueries(): AgentQueryInfo[] {
    return queryAgentQueries(this.store);
  }

  /** Changes since a timestamp — for incremental TUI updates. */
  changesSince(timestamp: number): {
    events: QuorumEvent[];
    hasStateChanges: boolean;
  } {
    return this.assembler.changesSince(timestamp);
  }
}
