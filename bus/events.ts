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
  role: "implementer" | "scout" | "reviewer" | "planner";
  model?: string;
  worktree?: string;
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
