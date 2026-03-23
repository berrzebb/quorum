/**
 * Quorum Event Protocol — the common language spoken by all providers and the daemon.
 *
 * Every adapter normalizes its native events into these types before emitting to the bus.
 * The daemon TUI consumes only these types — it never knows which provider produced them.
 */

// ── Base ──────────────────────────────────────────────

export interface QuorumEvent {
  type: EventType;
  timestamp: number;
  source: ProviderKind;
  sessionId?: string;
  trackId?: string;
  agentId?: string;
  payload: Record<string, unknown>;
}

export type ProviderKind = "claude-code" | "codex" | "cursor" | "gemini" | "generic";

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
  | "fitness.trend";

// ── Typed payloads ────────────────────────────────────

export interface AuditVerdictPayload {
  itemId: string;
  verdict: "approved" | "changes_requested" | "infra_failure";
  codes?: string[];
  summary?: string;
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

// ── Finding types ─────────────────────────────────────

export type FindingSeverity = "critical" | "major" | "minor" | "style";
export type FindingStatus = "open" | "confirmed" | "dismissed" | "fixed";

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

// ── Fitness types ────────────────────────────────────

export interface FitnessComponent {
  value: number;       // 0.0-1.0 normalized
  raw: number;         // raw metric value
  weight: number;      // contribution weight
  label: string;
}

export interface FitnessScore {
  total: number;       // 0.0-1.0 weighted sum
  components: {
    typeSafety: FitnessComponent;    // weight 0.25 — as any count, type errors
    testCoverage: FitnessComponent;  // weight 0.25 — line/branch coverage
    patternScan: FitnessComponent;   // weight 0.20 — HIGH findings count
    buildHealth: FitnessComponent;   // weight 0.15 — tsc + eslint pass rate
    complexity: FitnessComponent;    // weight 0.15 — avg cyclomatic complexity
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

// ── Factory ───────────────────────────────────────────

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
