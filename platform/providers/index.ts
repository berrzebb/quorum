// ── platform/providers barrel ─────────────────────────
// Re-exports all provider modules moved to platform/providers/

export {
  registerProvider,
  getProvider,
  listProviders,
} from "./provider.js";
export type {
  QuorumProvider,
  ProviderCapability,
  ProviderConfig,
  ProviderStatus,
  AuditorConfig,
  Auditor,
  AuditRequest,
  AuditResult,
} from "./provider.js";

export { TierRouter } from "./router.js";
export type {
  RouterConfig,
  RoutingDecision,
  ComplexityScore,
  TaskContext,
  Tier,
} from "./router.js";

export { DeliberativeConsensus } from "./consensus.js";
export type {
  ConsensusConfig,
  ConsensusVerdict,
  ConsensusRole,
  RoleOpinion,
  ConvergenceRegisters,
  ClassificationResult,
  DivergeConvergeOptions,
  DivergenceItem,
} from "./consensus.js";
export type { Classification } from "./consensus.js";

export { evaluateTrigger } from "./trigger.js";
export type {
  TriggerContext,
  TriggerResult,
  ConsensusMode,
} from "./trigger.js";

export { detectDomains, formatDomainSummary, DOMAIN_NAMES } from "./domain-detect.js";
export type {
  DetectedDomains,
  DomainDetectionResult,
} from "./domain-detect.js";

export { selectReviewers, getActiveRejectionCodes, listDomainReviewers } from "./domain-router.js";
export type {
  DomainReviewer,
  SelectedReviewer,
  ReviewerSelection,
  ReviewerTier,
} from "./domain-router.js";

export {
  runSpecialistReviews,
  runSpecialistTool,
  enrichEvidence,
  buildSpecialistSection,
  parseToolFindings,
  detectMissingSpecialists,
} from "./specialist.js";
export type {
  ToolResult,
  SpecialistOpinion,
  SpecialistFinding,
  SpecialistReviewResult,
  SpawnCandidate,
} from "./specialist.js";

export { AgentLoader } from "./agent-loader.js";
export type {
  AgentPersona,
  LoaderConfig,
} from "./agent-loader.js";

export { ASTAnalyzer } from "./ast-analyzer.js";
export type {
  ASTFindingCategory,
  ASTFinding,
  FileMetrics,
  ASTAnalysisResult,
  AggregateMetrics,
  RegexCandidate,
  ASTAnalyzerConfig,
  UnusedExport,
  ImportCycle,
  ContractDrift,
  ProgramAnalysisResult,
} from "./ast-analyzer.js";

// ── Auditors ─────────────────────────────────────────
export {
  ClaudeAuditor,
  OpenAIAuditor,
  GeminiAuditor,
  OpenAICompatibleAuditor,
  OllamaAuditor,
  VllmAuditor,
  createAuditor,
  createConsensusAuditors,
  parseSpec,
  listAuditorProviders,
  parseAuditResponse,
  extractJson,
} from "./auditors/index.js";
export type {
  ClaudeAuditorConfig,
  OpenAIAuditorConfig,
  GeminiAuditorConfig,
  OpenAICompatibleConfig,
  ToolDefinition,
  ToolExecutor,
  OllamaAuditorConfig,
  VllmAuditorConfig,
  AuditorSpec,
} from "./auditors/index.js";

export {
  MuxAuditor,
  createMuxConsensusAuditors,
  buildArgs,
  isComplete,
  parseAuditOutput,
  extractAssistantText,
} from "./auditors/mux.js";
export type { MuxAuditorConfig } from "./auditors/mux.js";

export { checkAvailability } from "./auditors/factory.js";

// ── Session Runtime ─────────────────────────────────
export type {
  ProviderExecutionMode,
  ProviderSessionRef,
  SessionRuntimeRequest,
  ProviderRuntimeEvent,
  ProviderApprovalRequest,
  ProviderApprovalDecision,
  SessionRuntime,
  ProviderToolBridge,
  ProviderRuntimeFactory,
} from "./session-runtime.js";

// ── Runtime Selector ────────────────────────────────
export {
  defaultRuntimeConfig,
  resolveExecutionMode,
  mergeRuntimeConfig,
  isSessionRuntimeEnabled,
} from "./runtime-selector.js";
export type { ProviderRuntimeConfig } from "./runtime-selector.js";

export { createRuntimeEvent } from "./event-mapper.js";
export type { ProviderEventMapper } from "./event-mapper.js";

export { InMemorySessionLedger } from "./session-ledger.js";
export type { SessionLedger } from "./session-ledger.js";

// ── Evaluators ──────────────────────────────────────
export * as evaluators from "./evaluators/index.js";

// ── Claude SDK ──────────────────────────────────────
export {
  isClaudeSdkAvailable,
  loadClaudeSdk,
  ClaudeSdkToolBridge,
} from "./claude-sdk/tool-bridge.js";
export type {
  ClaudeSdkLoadResult,
  ClaudeToolBridgeConfig,
  SdkToolDefinition,
} from "./claude-sdk/tool-bridge.js";

export { ClaudeSdkEventMapper } from "./claude-sdk/mapper.js";

export { ClaudeSdkSessionApi } from "./claude-sdk/session-api.js";
export type { SdkSessionInfo } from "./claude-sdk/session-api.js";

export { ClaudeSdkRuntime } from "./claude-sdk/runtime.js";

export { ClaudePermissionBridge } from "./claude-sdk/permissions.js";
export type {
  ClaudePermissionMode,
  ClaudePermissionConfig,
  ToolPermissionResult,
} from "./claude-sdk/permissions.js";

// ── Codex App Server ────────────────────────────────
export { CodexAppServerRuntime } from "./codex/app-server/runtime.js";
export { CodexAppServerClient } from "./codex/app-server/client.js";
export { CodexAppServerMapper } from "./codex/app-server/mapper.js";
export * from "./codex/app-server/protocol.js";

// ── Provider implementations ─────────────────────────
export { ClaudeCodeProvider } from "./claude-code/adapter.js";
export { CodexProvider } from "./codex/adapter.js";
export { CodexAuditor } from "./codex/auditor.js";
export type { CodexAuditorConfig } from "./codex/auditor.js";
