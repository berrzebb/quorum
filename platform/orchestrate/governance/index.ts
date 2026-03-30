// Governance layer — RTM, phase gates, lifecycle, fitness, scope, confluence
// Modules added by ORC-17 through ORC-19

export { generateSkeletalRTM } from "./rtm-generator.js";
export { updateRTM, updateRTMContent } from "./rtm-updater.js";
export { verifyPhaseCompletion, isWaveFullyCompleted, getRetryItems } from "./phase-gates.js";
export { shouldTriggerRetro, buildWaveCommitMessage, waveCommit, amendWaveCommit, autoRetro, autoMerge } from "./lifecycle-hooks.js";
export { collectFitnessSignals, runFitnessGate, computeFitness, runTscCached, invalidateTscCache } from "./fitness-gates.js";
export type { TscCacheEntry } from "./fitness-gates.js";
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
  isAllowedVerifier,
  ALLOWED_VERIFY_PREFIXES, VERIFY_SHELL_META, VERIFY_INTERPRETER_RE,
} from "./scope-gates.js";
export { runConfluenceCheck, proposeConfluenceAmendments } from "./confluence-gates.js";
export type { ConfluenceInput, ConfluenceResult } from "./confluence-gates.js";
export { runE2EVerification } from "./e2e-verification.js";

// Runtime evaluation gate — surface-matched evaluation enforcement
export type { RuntimeEvaluationGateResult } from "./runtime-evaluation-gate.js";
export { runRuntimeEvaluationGate } from "./runtime-evaluation-gate.js";

// Adaptive gate profiles — risk-based gate subset selection
export type { AdaptiveGateProfile } from "./adaptive-gate-profile.js";
export {
  MINIMAL_PROFILE, STANDARD_PROFILE, FULL_PROFILE,
  selectGateProfile, getEffectiveGates, shouldRunGate,
} from "./adaptive-gate-profile.js";

// Iteration budget — consumption tracking + escalation decisions
export type { IterationState, IterationDecision } from "./iteration-budget.js";
export { createIterationState, decideNextAction, recordIteration } from "./iteration-budget.js";

// [CONTRACT CONTROL PLANE] Re-export contract types for phase-gate consumers
export type { PromotionGate, PromotionGateResult } from "../../bus/promotion-gate.js";
