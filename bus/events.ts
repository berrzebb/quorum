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
  | "merge.conflict";

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
