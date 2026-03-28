/**
 * State data shapes — mirrors the exact structures currently serialized
 * by runner.ts (wave-state JSON, agent JSON, wave manifests, RTM).
 *
 * Types only. No implementation, no I/O.
 */

// ── Wave Checkpoint ──────────────────────────

/** Persisted as `.claude/quorum/wave-state-{trackName}.json` */
export interface WaveCheckpoint {
  trackName: string;
  completedIds: string[];
  failedIds: string[];
  /** Wave index that was last fully completed (audit passed) */
  lastCompletedWave: number;
  updatedAt: string;
  /** Total items in track (for progress calculation) */
  totalItems?: number;
  /** Last fitness score (0.0-1.0) */
  lastFitness?: number;
  /** Total wave count */
  totalWaves?: number;
}

// ── Agent Session ────────────────────────────

/** Persisted as `.claude/agents/{sessionId}.json` */
export interface AgentSessionState {
  id: string;
  name: string;
  backend: string;
  role: string;
  type: string;
  trackName: string;
  wbId: string;
  startedAt: number;
  status: string;
  outputFile?: string;
}

// ── Wave Manifest ────────────────────────────

/**
 * Recorded per-wave to SQLite MessageBus (KV: `wave:manifest:{track}:{index}`).
 * Next wave reads this for mechanical dependency context injection.
 */
export interface WaveManifestEntry {
  trackName: string;
  waveIndex: number;
  completedItems: string[];
  changedFiles: string[];
  fileExports: Record<string, string[]>;
  recordedAt: number;
}

// ── RTM (Requirements Traceability Matrix) ───

export type RTMStatus = "pending" | "implemented" | "passed" | "failed";

/** One row of the Forward Trace table in rtm.md */
export interface RTMEntry {
  reqId: string;
  description: string;
  targetFiles: string;
  verifyCommand: string;
  doneCriteria: string;
  status: RTMStatus;
}

/** Full RTM document state (both trace directions + summary) */
export interface RTMState {
  trackName: string;
  forwardTrace: RTMEntry[];
  /** Backward trace rows (populated by Scout after implementation) */
  backwardTrace: Array<{
    testFile: string;
    coversReq: string;
    importChain: string;
    status: string;
  }>;
  summary: {
    totalRequirements: number;
    covered: number;
    gaps: number;
    orphanTests: number;
  };
}
