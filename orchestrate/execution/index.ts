// Execution layer — model routing, agent sessions, audit/fixer loops

export {
  selectModelForTask,
  HIGH_RISK_DOMAINS,
  MEDIUM_RISK_DOMAINS,
  type ModelSelection,
} from "./model-routing.js";

export {
  buildDepContextFromManifests,
  type WaveManifest,
} from "./dependency-context.js";

export {
  buildImplementerPrompt,
  type RosterEntry,
} from "./implementer-prompt.js";

export {
  runPreflightCheck,
  walkSourceFiles,
  type PreflightResult,
} from "./preflight.js";

export {
  buildWaveRoster,
  canSpawnItem,
  type RosterSlot,
} from "./roster-builder.js";

export {
  WaveSessionState,
  type ActiveSession,
  type FailedItem,
} from "./session-state.js";

export {
  spawnAgent,
  saveAgentState,
  removeAgentState,
  captureAgentOutput,
  isAgentComplete,
  type SpawnAgentOptions,
  type AgentHandle,
  type AgentSessionState,
} from "./agent-session.js";

export {
  runWaveAuditGates,
  type WaveAuditResult,
  type WaveAuditOptions,
} from "./audit-loop.js";

export {
  runFixer,
  runFixCycle,
  type FixerOptions,
  type FixerResult,
  type FixCycleOptions,
  type FixCycleResult,
} from "./fixer-loop.js";

export {
  runWave,
  type WaveRunnerOptions,
  type WaveResult,
} from "./wave-runner.js";

export { runWaveAuditLLM } from "./wave-audit-llm.js";

export {
  captureSnapshot,
  recordWaveManifest,
  readPreviousManifests,
} from "./snapshot.js";
