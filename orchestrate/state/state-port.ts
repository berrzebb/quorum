/**
 * Abstract port contracts (repository/adapter pattern).
 *
 * Execution code depends on these interfaces — never on filesystem
 * or SQLite directly. Implementations (ORC-15: filesystem, ORC-16: SQLite)
 * fulfill these contracts.
 *
 * Interfaces only. No implementation, no I/O.
 */

import type {
  WaveCheckpoint,
  AgentSessionState,
  WaveManifestEntry,
  RTMEntry,
  RTMStatus,
  RTMState,
} from "./state-types.js";

// ── Checkpoint Port ──────────────────────────

export interface CheckpointPort {
  load(trackName: string): WaveCheckpoint | null;
  save(checkpoint: WaveCheckpoint): void;
}

// ── Agent State Port ─────────────────────────

export interface AgentStatePort {
  load(agentId: string): AgentSessionState | null;
  save(state: AgentSessionState): void;
  remove(agentId: string): void;
  /** List all active agent sessions (for daemon discovery) */
  list(): AgentSessionState[];
}

// ── Manifest Port ────────────────────────────

export interface ManifestPort {
  load(trackName: string, waveIndex: number): WaveManifestEntry | null;
  save(manifest: WaveManifestEntry): void;
  /** Load all manifests for waves [0, beforeWaveIndex) */
  loadPrevious(trackName: string, beforeWaveIndex: number): WaveManifestEntry[];
}

// ── RTM Port ─────────────────────────────────

export interface RTMPort {
  load(trackDir: string): RTMState | null;
  save(trackDir: string, state: RTMState): void;
  /** Update status for specific requirement IDs (common hot-path) */
  updateStatus(trackDir: string, reqIds: string[], status: RTMStatus): void;
  /** Check whether an RTM exists for the given track directory */
  exists(trackDir: string): boolean;
}

// ── Composite Port ───────────────────────────

/**
 * Single entry point for all orchestrator state access.
 * Passed into runner/lifecycle functions to replace direct I/O.
 */
export interface StatePort {
  checkpoint: CheckpointPort;
  agentState: AgentStatePort;
  manifest: ManifestPort;
  rtm: RTMPort;
}
