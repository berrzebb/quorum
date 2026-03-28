/**
 * SnapshotAssembler — thin orchestrator that calls domain-specific query modules
 * and assembles the full daemon state snapshot.
 *
 * Replaces the monolithic StateReader class for new code.
 * StateReader is kept as a backward-compatible wrapper.
 */

import type { EventStore } from "../../platform/bus/store.js";
import type { LockInfo } from "../../platform/bus/lock.js";
import type { QuorumEvent } from "../../platform/bus/events.js";
import type { MessageBus } from "../../platform/bus/message-bus.js";

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
} from "./queries/index.js";

import type {
  GateInfo,
  FindingInfo,
  FindingStats,
  ReviewProgressInfo,
  ThreadMessage,
  FileThread,
  ParliamentCommitteeStatus,
  ParliamentLiveSession,
  ParliamentInfo,
  SpecialistInfo,
  AgentQueryInfo,
  TrackInfo,
  ItemStateInfo,
  FitnessInfo,
} from "./queries/index.js";

// ── FullState type ───────────────────────────

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
  agentQueries: AgentQueryInfo[];
}

// ── SnapshotAssembler ────────────────────────

export class SnapshotAssembler {
  private store: EventStore;
  private messageBus: MessageBus | null;
  private _liveSessionsCache: { ts: number; data: ParliamentLiveSession[] } = { ts: 0, data: [] };

  constructor(store: EventStore, messageBus?: MessageBus | null) {
    this.store = store;
    this.messageBus = messageBus ?? null;
  }

  /**
   * Read all state in one call — efficient for TUI polling.
   */
  readAll(eventLimit = 20): FullState {
    const db = this.store.getDb();
    return {
      gates: queryGateStatus(this.store),
      items: queryItemStates(db),
      locks: queryActiveLocks(db),
      specialists: queryActiveSpecialists(this.store),
      tracks: queryTrackProgress(this.store),
      findings: queryOpenFindings(this.store, this.messageBus),
      findingStats: queryFindingStats(this.store, this.messageBus),
      reviewProgress: queryReviewProgress(this.store),
      fileThreads: queryFindingThreads(this.store, this.messageBus),
      recentEvents: this.store.recent(eventLimit),
      fitness: queryFitnessInfo(this.store),
      parliament: queryParliamentInfo(this.store, this._liveSessionsCache),
      agentQueries: queryAgentQueries(this.store),
    };
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
}

// ── Re-exports ───────────────────────────────

export type {
  GateInfo,
  FindingInfo,
  FindingStats,
  ReviewProgressInfo,
  ThreadMessage,
  FileThread,
  ParliamentCommitteeStatus,
  ParliamentLiveSession,
  ParliamentInfo,
  SpecialistInfo,
  AgentQueryInfo,
  TrackInfo,
  ItemStateInfo,
  FitnessInfo,
};

export {
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
};
