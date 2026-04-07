/**
 * Quorum Event Protocol — the common language spoken by all providers and the daemon.
 *
 * Every adapter normalizes its native events into these types before emitting to the bus.
 * The daemon TUI consumes only these types — it never knows which provider produced them.
 */

// ── Base ──────────────────────────────────────────

export interface QuorumEvent {
  type: EventType;
  timestamp: number;
  source: ProviderKind;
  sessionId?: string;
  trackId?: string;
  agentId?: string;
  payload: Record<string, unknown>;
}

export type ProviderKind = "claude-code" | "codex" | "cursor" | "gemini" | "ollama" | "vllm" | "openai" | "generic";

export type EventType =
  // Lifecycle
  | "session.start"
  | "session.stop"
  | "session.compact"
  // Agent
  | "agent.spawn"
  | "agent.progress"
  | "agent.idle"
  | "agent.complete"
  | "agent.error"
  // Audit cycle
  | "audit.submit"
  | "audit.start"
  | "audit.verdict"
  | "audit.correction"
  // Specialist domain review
  | "specialist.detect"
  | "specialist.tool"
  | "specialist.review"
  // Retrospective
  | "retro.start"
  | "retro.complete"
  // Track management
  | "track.create"
  | "track.progress"
  | "track.complete"
  | "track.blocked"
  | "track.parent.ready"
  // Evidence
  | "evidence.write"
  | "evidence.sync"
  // Quality gate
  | "quality.check"
  | "quality.pass"
  | "quality.fail"
  // Merge
  | "merge.start"
  | "merge.complete"
  | "merge.conflict"
  // Finding lifecycle
  | "finding.detect"
  | "finding.ack"
  | "finding.resolve"
  | "finding.claim"
  // Evidence + review
  | "evidence.submit"
  | "review.progress"
  // Agent communication
  | "agent.query"
  | "agent.response"
  // Context lifecycle
  | "context.save"
  | "context.restore"
  // Dynamic specialist
  | "specialist.spawn"
  // Fitness
  | "fitness.compute"
  | "fitness.gate"
  | "fitness.trend"
  // Audit lifecycle (escalation)
  | "audit.escalate"
  | "audit.downgrade"
  | "audit.retry"
  // Finding ownership
  | "finding.ownership_transferred"
  // Parliament
  | "parliament.session.start"
  | "parliament.debate.round"
  | "parliament.amendment.propose"
  | "parliament.amendment.vote"
  | "parliament.amendment.resolve"
  | "parliament.convergence"
  | "parliament.meeting.log"
  | "parliament.session.digest"
  | "parliament.session.normalform"
  | "parliament.cps.generated"
  // Steering
  | "steering.switch"
  // Dream / Retro Intelligence
  | "dream.trigger.evaluate"
  | "dream.consolidation.start"
  | "dream.consolidation.complete"
  | "dream.consolidation.failed"
  | "dream.digest.generated"
  | "dream.prune.applied"
  // Wave file tracking (replaces git-based changedFiles)
  | "wave.files";

// ── Typed payloads ────────────────────────────────

/** Canonical audit verdict status values. Shared across MJS and TS layers. */
export const AUDIT_VERDICT = {
  APPROVED: "approved",
  CHANGES_REQUESTED: "changes_requested",
  INFRA_FAILURE: "infra_failure",
} as const;

export type AuditVerdict = typeof AUDIT_VERDICT[keyof typeof AUDIT_VERDICT];

export const AMENDMENT_STATUS = {
  PROPOSED: "proposed",
  APPROVED: "approved",
  REJECTED: "rejected",
  DEFERRED: "deferred",
} as const;

export type AmendmentStatusType = typeof AMENDMENT_STATUS[keyof typeof AMENDMENT_STATUS];

export interface AuditVerdictPayload {
  itemId: string;
  verdict: AuditVerdict;
  codes?: string[];
  summary?: string;
  mode?: string;
}

export interface AgentSpawnPayload {
  name: string;
  role: "implementer" | "scout" | "reviewer" | "planner" | "specialist";
  model?: string;
  worktree?: string;
  /** Specialist domain (only when role is "specialist"). */
  domain?: string;
}

export interface TrackProgressPayload {
  total: number;
  completed: number;
  pending: number;
  blocked: number;
}

export interface WaveFilesPayload {
  waveIndex: number;
  trackName: string;
  /** Files changed during wave execution (relative paths). */
  files: string[];
  /** Git snapshot ref at wave start. */
  snapshotRef?: string;
}

export interface QualityCheckPayload {
  file: string;
  label: string;
  passed: boolean;
  output?: string;
}

export interface SpecialistDetectPayload {
  /** Number of active domains detected. */
  activeCount: number;
  /** List of active domain names. */
  domains: string[];
  /** Number of tools to run. */
  toolCount: number;
  /** Number of LLM agents to invoke. */
  agentCount: number;
}

export interface SpecialistToolPayload {
  tool: string;
  domain: string;
  status: "pass" | "fail" | "warn" | "error" | "skip";
  duration: number;
}

export interface SpecialistReviewPayload {
  agent: string;
  domain: string;
  verdict: "approved" | "changes_requested";
  codes: string[];
  confidence: number;
}

// ── Finding types ─────────────────────────────────

export type FindingSeverity = "critical" | "major" | "minor" | "style";
export type FindingStatus = "open" | "confirmed" | "dismissed" | "fixed";

/** Canonical finding status constants — use instead of raw string literals. */
export const FINDING_STATUS: Record<Uppercase<FindingStatus>, FindingStatus> = {
  OPEN: "open", CONFIRMED: "confirmed", DISMISSED: "dismissed", FIXED: "fixed",
} as const;

/** Canonical severity ordering. Higher = more severe. */
export const SEVERITY_RANK: Record<FindingSeverity, number> = {
  critical: 4, major: 3, minor: 2, style: 1,
};

export interface Finding {
  id: string;
  reviewerId: string;
  provider: string;
  severity: FindingSeverity;
  category: string;
  description: string;
  file?: string;
  line?: number;
  suggestion?: string;
  status: FindingStatus;
  /** Reviewers who independently detected the same issue (read-time dedup). */
  detectedBy?: string[];
  /** Agreement ratio: detectedBy.length / totalProviders (0.0–1.0). */
  consensusScore?: number;
  /** Parent finding ID for threaded replies (e.g. Reviewer-B responds to Reviewer-A). */
  replyTo?: string;
}

export interface FindingDetectPayload {
  findings: Finding[];
  reviewerId: string;
  provider: string;
}

export interface FindingAckPayload {
  findingId: string;
  action: "fix" | "dismiss";
  reason?: string;
}

export interface FindingResolvePayload {
  findingId: string;
  resolution: "fixed" | "dismissed" | "superseded";
}

export interface FindingClaimPayload {
  reviewerId: string;
  domain: string;
  provider: string;
}

export interface EvidenceSubmitPayload {
  findingCount: number;
  verdict: string;
  codes: string[];
  scope?: string;
}

/** Payload for evidence.write — raw evidence content stored in SQLite as single source of truth. */
export interface EvidenceContentPayload {
  content: string;
  changedFiles: string[];
  triggerTag: string;
  scope?: string;
}

export interface ReviewProgressPayload {
  reviewerId: string;
  provider: string;
  progress: number;
  phase: "analyzing" | "reviewing" | "summarizing" | "complete";
  estimatedMs?: number;
}

export interface AgentQueryPayload {
  queryId: string;
  fromAgent: string;
  toAgent?: string;  // null = broadcast
  question: string;
  context?: Record<string, unknown>;
}

export interface AgentResponsePayload {
  queryId: string;
  fromAgent: string;
  answer: string;
  confidence?: number;
}

export interface ContextSavePayload {
  sessionId: string;
  agentId: string;
  summary: string;
  findingCount: number;
  pendingItems: string[];
  round: number;
}

export interface SpecialistSpawnPayload {
  domain: string;
  trigger: "finding" | "detection" | "manual";
  reason: string;
  parentReviewerId?: string;
}

// ── Audit escalation types ───────────────────────

export interface AuditEscalatePayload {
  fromTier: "T1" | "T2" | "T3";
  toTier: "T1" | "T2" | "T3";
  reason: string;
  consecutiveFailures: number;
}

export interface AuditRetryPayload {
  round: number;
  previousVerdict: "approved" | "changes_requested" | "infra_failure";
  reason: string;
}

export interface FindingOwnershipTransferredPayload {
  findingId: string;
  fromAgent: string;
  toAgent: string;
  reason: string;
}

// ── Parliament types ────────────────────────────

export type ParliamentRole = "advocate" | "devil" | "judge" | "specialist" | "implementer";

export interface ParliamentSessionStartPayload {
  participants: Array<{ role: ParliamentRole; agentId: string }>;
  agenda: string[];
  votingRule: "majority";
  sessionType: "morning" | "afternoon";
}

export interface ParliamentDebateRoundPayload {
  round: number;
  speaker: string;
  role: ParliamentRole;
  opinion: string;
  confidence?: number;
}

export interface ParliamentAmendmentProposePayload {
  amendmentId: string;
  target: "prd" | "design" | "wb" | "scope";
  change: string;
  sponsor: string;
  justification: string;
}

export interface ParliamentAmendmentVotePayload {
  amendmentId: string;
  voter: string;
  position: "for" | "against" | "abstain";
  confidence: number;
}

export type MeetingClassification = "gap" | "strength" | "out" | "buy" | "build";

export interface ParliamentConvergencePayload {
  classifications: Array<{
    item: string;
    classification: MeetingClassification;
    action: string;
  }>;
  registers: {
    statusChanges: string[];
    decisions: string[];
    requirementChanges: string[];
    risks: string[];
  };
  convergenceScore: number;
}

export interface ParliamentSessionDigestPayload {
  agendaId: string;
  sessionType: "morning" | "afternoon";
  verdictResult: string;
  converged: boolean;
  amendmentsResolved: number;
  confluencePassed: boolean;
  errorCount: number;
  duration: number;
}

export interface ParliamentCPSPayload {
  context: string;
  problem: string;
  solution: string;
  sourceLogIds: string[];
  gapCount: number;
  buildCount: number;
  agendaId: string;
}

// ── Fitness types ────────────────────────────────

export interface FitnessComponent {
  value: number;       // 0.0-1.0 normalized
  raw: number;         // raw metric value
  weight: number;      // contribution weight
  label: string;
}

export interface FitnessScore {
  total: number;       // 0.0-1.0 weighted sum
  components: {
    typeSafety: FitnessComponent;    // weight 0.20 — as any count, type errors
    testCoverage: FitnessComponent;  // weight 0.20 — line/branch coverage
    patternScan: FitnessComponent;   // weight 0.20 — HIGH findings count
    buildHealth: FitnessComponent;   // weight 0.15 — tsc + eslint pass rate
    complexity: FitnessComponent;    // weight 0.10 — avg cyclomatic complexity
    security: FitnessComponent;      // weight 0.10 — security issues count
    dependencies: FitnessComponent;  // weight 0.05 — deprecated/vulnerable deps
  };
  timestamp: number;
  snapshotId: string;
}

export interface FitnessDelta {
  before: number;
  after: number;
  delta: number;       // after - before
  improved: boolean;
  components: Record<string, { before: number; after: number; delta: number }>;
}

export interface FitnessComputePayload {
  score: FitnessScore;
  fileCount: number;
}

export interface FitnessGatePayload {
  decision: "proceed" | "self-correct" | "auto-reject";
  current: number;     // current total score
  baseline: number;    // baseline total score
  delta: number;
  reason: string;
}

export interface FitnessTrendPayload {
  movingAverage: number;
  slope: number;       // positive = improving
  windowSize: number;
  dataPoints: number;
}

// ── Factory ───────────────────────────────────────

export function createEvent(
  type: EventType,
  source: ProviderKind,
  payload: Record<string, unknown> = {},
  meta: Partial<Pick<QuorumEvent, "sessionId" | "trackId" | "agentId">> = {},
): QuorumEvent {
  return {
    type,
    timestamp: Date.now(),
    source,
    ...meta,
    payload,
  };
}
