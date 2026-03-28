/**
 * State contracts — types + port interfaces + filesystem stores.
 * Re-exports everything for convenient single-import.
 */

// Data shapes
export type {
  WaveCheckpoint,
  AgentSessionState,
  WaveManifestEntry,
  RTMStatus,
  RTMEntry,
  RTMState,
} from "./state-types.js";

// Port contracts
export type {
  CheckpointPort,
  AgentStatePort,
  ManifestPort,
  RTMPort,
  StatePort,
} from "./state-port.js";

// Filesystem implementations
export { FilesystemCheckpointStore } from "./filesystem/checkpoint-store.js";
export { FilesystemAgentStateStore } from "./filesystem/agent-state-store.js";
export { FilesystemManifestStore, type ManifestBridge } from "./filesystem/manifest-store.js";
export { FilesystemRTMStore } from "./filesystem/rtm-store.js";

// Track file path resolution
export {
  resolveTrackDir,
  resolveDesignDir,
  resolveRTMPath,
  resolveWBPath,
  resolveCheckpointDir,
  resolveAgentDir,
} from "./filesystem/track-file-store.js";
