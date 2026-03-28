// Governance layer — RTM, phase gates, lifecycle, fitness, scope, confluence
// Modules added by ORC-17 through ORC-19

export { generateSkeletalRTM } from "./rtm-generator.js";
export { updateRTM, updateRTMContent } from "./rtm-updater.js";
export { verifyPhaseCompletion, isWaveFullyCompleted, getRetryItems } from "./phase-gates.js";
export { shouldTriggerRetro, buildWaveCommitMessage, waveCommit, amendWaveCommit, autoRetro, autoMerge } from "./lifecycle-hooks.js";
export { collectFitnessSignals, runFitnessGate, computeFitness } from "./fitness-gates.js";
export type { FitnessGateResult } from "./fitness-gates.js";
export {
  STUB_PATTERNS, PERF_PATTERNS,
  scanLines, scanForStubs, scanForPerfAntiPatterns,
  getChangedFiles,
  detectFileScopeViolations,
  scanBlueprintViolations,
  detectOrphanFiles,
  auditNewDependencies,
  checkTestFileCreation,
  checkWBConstraints,
  detectFixLoopStagnation,
  runProjectTests,
  detectRegressions,
} from "./scope-gates.js";
export { runConfluenceCheck, proposeConfluenceAmendments } from "./confluence-gates.js";
export type { ConfluenceInput, ConfluenceResult } from "./confluence-gates.js";
export { runE2EVerification } from "./e2e-verification.js";
