/**
 * Facade — main implementation at platform/core/bridge.mjs
 *
 * All exports are re-exported unchanged. No import paths in consumers need updating.
 */

// ── Init + Core ──
export {
  init,
  emitEvent,
  evaluateTrigger,
  recordVerdict,
  currentTier,
  detectStagnation,
  queryEvents,
} from "../platform/core/bridge.mjs";

// ── Locks ──
export {
  acquireLock,
  releaseLock,
  isLockHeld,
} from "../platform/core/bridge.mjs";

// ── KV State ──
export {
  getState,
  setState,
  getLatestEvidence,
} from "../platform/core/bridge.mjs";

// ── State Transitions ──
export {
  recordTransition,
  currentState,
  queryItemStates,
} from "../platform/core/bridge.mjs";

// ── File Claims ──
export {
  claimFiles,
  releaseFiles,
  checkConflicts,
  getClaims,
} from "../platform/core/bridge.mjs";

// ── Execution Planning ──
export {
  planExecution,
  selectExecutionMode,
  validatePlanClaims,
} from "../platform/core/bridge.mjs";

// ── Auto-Learning ──
export { analyzeAuditLearnings } from "../platform/core/bridge.mjs";

// ── UnitOfWork ──
export { createUnitOfWork } from "../platform/core/bridge.mjs";

// ── Domain + Specialist ──
export {
  detectDomains,
  selectReviewers,
  runSpecialistTools,
  enrichEvidence,
} from "../platform/core/bridge.mjs";

// ── MessageBus ──
export {
  getMessageBus,
  postAgentQuery,
  respondToAgentQuery,
  pollAgentQueries,
  getQueryResponses,
  getAgentRoster,
  setAgentRoster,
  parseToolFindings,
} from "../platform/core/bridge.mjs";

// ── Fitness ──
export {
  getFitnessLoop,
  computeFitness,
} from "../platform/core/bridge.mjs";

// ── Blast Radius ──
export { computeBlastRadius } from "../platform/core/bridge.mjs";

// ── HookRunner ──
export {
  initHookRunner,
  getHookRunner,
  fireHook,
  checkHookGate,
} from "../platform/core/bridge.mjs";

// ── Parliament ──
export {
  runParliamentSession,
  checkParliamentConvergence,
  proposeAmendment,
  verifyConfluence,
  getConvergenceReport,
} from "../platform/core/bridge.mjs";

// ── Parliament Gates ──
export {
  checkParliamentGates,
  checkAmendmentGate,
  checkVerdictGate,
  checkConfluenceGate,
  checkDesignGate,
} from "../platform/core/bridge.mjs";

// ── Consensus Auditors ──
export { createConsensusAuditors } from "../platform/core/bridge.mjs";

// ── Lifecycle ──
export { close } from "../platform/core/bridge.mjs";
