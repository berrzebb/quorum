// platform/bus — event, governance, and runtime bus modules
export * from './events.js';
export * from './store.js';
export * from './bus.js';
export * from './lock.js';
export * from './claim.js';
export * from './normal-form.js';
// fitness.ts re-exports FitnessScore/FitnessComponent/FitnessDelta from events.ts —
// use selective exports to avoid TS2308 duplicate identifier conflicts with events.ts
export { computeFitness, computeDelta, computeTrend } from './fitness.js';
export type { FitnessSignals, FitnessConfig } from './fitness.js';
export * from './fitness-loop.js';
export * from './stagnation.js';
export * from './auto-learn.js';
export * from './projector.js';
export * from './parallel.js';
export * from './orchestrator.js';
export * from './blueprint-parser.js';
// message-bus.ts re-exports Finding/FindingSeverity/FindingStatus from events.ts —
// use selective exports to avoid TS2308 duplicate identifier conflicts with events.ts
export { MessageBus } from './message-bus.js';
export type {
  FindingSummary,
  FindingContext,
  FindingDetail,
  FindingThread,
  SubmitFindingsOpts,
  PostQueryOpts,
  RespondToQueryOpts,
  ReplyToFindingOpts,
} from './message-bus.js';
export * from './confluence.js';
export * from './mux.js';
export * from './parliament-gate.js';
export * from './parliament-session.js';
export * from './meeting-log.js';
export * from './amendment.js';
export * from './contract-enforcer.js';
export * from './promotion-gate.js';
export * from './handoff-gate.js';
export * from './provider-approval-gate.js';
export * from './provider-session-projector.js';
