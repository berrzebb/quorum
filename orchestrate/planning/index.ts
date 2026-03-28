// Planning layer — legislation/blueprint generation
// Modules will be added by ORC-3 through ORC-13

// Re-export types
export type { WorkItem, WBItem, TrackInfo, PlanReviewResult, Wave, WaveGroup, WBSize, HeadingInfo } from './types.js';

// Track catalog — discovery and resolution
export { findTracks, resolveTrack, trackRef } from './track-catalog.js';

// WB heading parser — heading identification and classification
export {
  parseHeading, classifyHeading, scanHeadings,
  ID_PATTERN, PARENT_LABEL_PATTERN,
} from './wb-heading-parser.js';
export type { HeadingKind } from './wb-heading-parser.js';

// WB field parser — field extraction from section bodies
export {
  parseFields,
  extractTargetFiles, extractDependsOn, extractAction,
  extractContextBudget, extractVerify, extractConstraints,
  extractDone, extractSizeFromBody, extractIntegrationTarget,
} from './wb-field-parser.js';

// Work breakdown parser — assembled from heading + field parsers
export { parseWorkBreakdown } from './work-breakdown-parser.js';

// Plan review gate — structural validation before execution
export { reviewPlan } from './plan-review.js';

// Wave graph builder — topological wave computation
export { computeWaves } from './wave-graph.js';

// Design gates — mermaid diagram verification
export { verifyDesignDiagrams } from './design-gates.js';

// CPS loader — parliament CPS file discovery and loading
export type { CPSContent } from './cps-loader.js';
export { findCPSFiles, loadCPS, loadPlannerProtocol } from './cps-loader.js';

// Planner prompts — pure prompt string builders
export type { SystemPromptOpts, AutoPromptOpts, SocraticPromptOpts } from './planner-prompts.js';
export { buildPlannerSystemPrompt, buildSocraticPrompt, buildInlineAutoPrompt, buildAutoPrompt, derivePrefix } from './planner-prompts.js';

// Planner mode — mode determination logic
export type { PlannerModeOpts } from './planner-mode.js';
export { determinePlannerMode } from './planner-mode.js';

// Planner session — high-level planner orchestration flow
export type { PlannerSessionOptions, PlannerSessionResult } from './planner-session.js';
export { runPlannerSession } from './planner-session.js';

// Auto-planner — headless WB generation + design diagram auto-fix
export { autoGenerateWBs, autoFixDesignDiagrams } from './auto-planner.js';
