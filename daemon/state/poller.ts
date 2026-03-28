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

/**
 * Compute a fingerprint for snapshot diffing.
 * Returns a string that changes when the snapshot data changes.
 */
export function computeSnapshotFingerprint(state: FullState): string {
  // Use a lightweight hash of key indicators:
  // - gate statuses
  // - item count
  // - finding count
  // - track progress
  // - recent event count
  // - parliament session count
  const parts = [
    state.gates.map(g => `${g.name}:${g.status}`).join(","),
    `items:${state.items.length}`,
    `findings:${state.findings.length}`,
    `tracks:${state.tracks.map(t => `${t.trackId}:${t.completed}`).join(",")}`,
    `events:${state.recentEvents.length}`,
    `parliament:${state.parliament.sessionCount}`,
    `locks:${state.locks.length}`,
    `fitness:${state.fitness.current}`,
  ];
  return parts.join("|");
}

// ── Snapshot Diffing ────────────────────────

/**
 * Result of a snapshot diff.
 */
export interface SnapshotDiff {
  changed: boolean;
  fingerprint: string;
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
      fingerprint: computeSnapshotFingerprint(next),
      changedSections: new Set([
        "gates", "items", "findings", "tracks",
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
  if (prev.items.length !== next.items.length) changedSections.add("items");
  if (prev.findings.length !== next.findings.length) changedSections.add("findings");
  if (prev.tracks.length !== next.tracks.length ||
      prev.tracks.some((t, i) => t.completed !== next.tracks[i]?.completed)) {
    changedSections.add("tracks");
  }
  if (prev.recentEvents.length !== next.recentEvents.length) changedSections.add("events");
  if (prev.parliament.sessionCount !== next.parliament.sessionCount) changedSections.add("parliament");
  if (prev.locks.length !== next.locks.length) changedSections.add("locks");
  if (prev.fitness.current !== next.fitness.current) changedSections.add("fitness");
  if (prev.specialists.length !== next.specialists.length) changedSections.add("specialists");
  if (prev.findingStats.total !== next.findingStats.total) changedSections.add("findingStats");

  return {
    changed: changedSections.size > 0,
    fingerprint: computeSnapshotFingerprint(next),
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
  private lastFingerprint: string = "";
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
        this.lastFingerprint = diff.fingerprint;
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
