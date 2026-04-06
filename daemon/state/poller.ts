/**
 * Shell-level Poll Scheduler — centralizes all daemon polling into a single service.
 *
 * Replaces per-component timers (app.tsx 1s state poll, AgentChatPanel 2s/5s polls)
 * with a unified scheduler that provides snapshot + diff to consumers.
 *
 * Panels subscribe to updates and receive only changed sections,
 * avoiding unnecessary re-renders.
 */

import type { FullState } from "./snapshot.js";

// ── Poll Configuration ──────────────────────

/**
 * Configuration for the poll scheduler.
 */
export interface PollConfig {
  /** Interval for state polling in ms (default: 1000) */
  stateIntervalMs: number;
  /** Interval for session output polling in ms (default: 2000) */
  sessionIntervalMs: number;
  /** Interval for git context polling in ms (default: 5000) */
  gitIntervalMs: number;
}

/**
 * Default poll configuration.
 */
export function defaultPollConfig(): PollConfig {
  return {
    stateIntervalMs: 1000,
    sessionIntervalMs: 2000,
    gitIntervalMs: 5000,
  };
}

// ── Snapshot Fingerprinting ─────────────────

// ── Snapshot Diffing ────────────────────────

/**
 * Result of a snapshot diff.
 */
export interface SnapshotDiff {
  changed: boolean;
  /** Which sections changed (for targeted panel updates) */
  changedSections: Set<string>;
}

/**
 * Compare two snapshots and return which sections changed.
 */
export function diffSnapshots(
  prev: FullState | null,
  next: FullState
): SnapshotDiff {
  if (!prev) {
    return {
      changed: true,
      changedSections: new Set([
        "gates", "items", "findings", "findingStats", "tracks",
        "events", "parliament", "locks", "fitness",
        "specialists", "reviewProgress", "fileThreads", "agentQueries",
      ]),
    };
  }

  const changedSections = new Set<string>();

  if (prev.gates.length !== next.gates.length ||
      prev.gates.some((g, i) => g.status !== next.gates[i]?.status)) {
    changedSections.add("gates");
  }
  if (prev.items.length !== next.items.length ||
      prev.items.some((it, i) => it.currentState !== next.items[i]?.currentState)) {
    changedSections.add("items");
  }
  if (prev.findings.length !== next.findings.length ||
      prev.findings.some((f, i) => f.severity !== next.findings[i]?.severity)) {
    changedSections.add("findings");
  }
  if (prev.tracks.length !== next.tracks.length ||
      prev.tracks.some((t, i) => t.completed !== next.tracks[i]?.completed)) {
    changedSections.add("tracks");
  }
  if (prev.recentEvents.length !== next.recentEvents.length) changedSections.add("events");
  if (prev.agentEvents.length !== next.agentEvents.length) changedSections.add("agents");
  if (prev.parliament.sessionCount !== next.parliament.sessionCount) changedSections.add("parliament");
  if (prev.locks.length !== next.locks.length) changedSections.add("locks");
  if (prev.fitness.current !== next.fitness.current) changedSections.add("fitness");
  if (prev.specialists.length !== next.specialists.length) changedSections.add("specialists");
  if (prev.findingStats.total !== next.findingStats.total) changedSections.add("findingStats");
  if (prev.reviewProgress.length !== next.reviewProgress.length ||
      prev.reviewProgress.some((r, i) => r.progress !== next.reviewProgress[i]?.progress)) {
    changedSections.add("reviewProgress");
  }
  if (prev.fileThreads.length !== next.fileThreads.length) changedSections.add("fileThreads");
  if (prev.agentQueries.length !== next.agentQueries.length) changedSections.add("agentQueries");

  return {
    changed: changedSections.size > 0,
    changedSections,
  };
}

// ── Poll Scheduler ──────────────────────────

/**
 * Shell-level poll scheduler.
 * Manages all polling intervals and provides snapshot + diff to consumers.
 */
export class PollScheduler {
  private config: PollConfig;
  private stateTimer: ReturnType<typeof setInterval> | null = null;
  private _running = false;

  constructor(config?: Partial<PollConfig>) {
    this.config = { ...defaultPollConfig(), ...config };
  }

  get running(): boolean {
    return this._running;
  }

  /**
   * Start the state polling loop.
   * Calls onUpdate only when the snapshot actually changes.
   */
  startStatePolling(
    readState: () => FullState,
    onUpdate: (state: FullState, diff: SnapshotDiff) => void
  ): void {
    if (this._running) return;
    this._running = true;

    let prevState: FullState | null = null;

    this.stateTimer = setInterval(() => {
      const state = readState();
      const diff = diffSnapshots(prevState, state);

      if (diff.changed) {
        prevState = state;
        onUpdate(state, diff);
      }
    }, this.config.stateIntervalMs);
  }

  /**
   * Stop all polling.
   */
  stop(): void {
    this._running = false;
    if (this.stateTimer) {
      clearInterval(this.stateTimer);
      this.stateTimer = null;
    }
  }

  /**
   * Get current config.
   */
  getConfig(): PollConfig {
    return { ...this.config };
  }
}
