/**
 * Unified Session Model — provider-agnostic representation of AI agent sessions.
 *
 * Session → Turn → Action. Three adapter parsers (Claude Code, Codex, Gemini)
 * normalize their native formats into this model for vault storage and search.
 */

// ── Core Model ──────────────────────────────────

export type Provider = "claude-code" | "codex" | "gemini";

export interface Session {
  id: string;
  provider: Provider;
  startedAt: number;
  endedAt?: number;
  cwd: string;
  turns: Turn[];
  metadata: SessionMetadata;
}

export interface SessionMetadata {
  version?: string;
  gitBranch?: string;
  model?: string;
  /** Original raw file path (for vault/raw/ reference). */
  rawPath?: string;
  [key: string]: unknown;
}

export interface Turn {
  id: string;
  sequence: number;
  role: "user" | "assistant";
  content: string;
  thinking?: string;
  actions: Action[];
  timestamp: number;
  usage?: TokenUsage;
}

export interface TokenUsage {
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
}

export interface Action {
  id: string;
  type: "tool_call" | "tool_result";
  tool: string;
  input?: Record<string, unknown>;
  output?: string;
  error?: boolean;
  timestamp: number;
}

// ── Parser Interface ────────────────────────────

export interface SessionParser {
  /** Check if this parser can handle the given file. */
  canParse(filePath: string, firstLine?: string): boolean;
  /** Parse a session file into the unified model. */
  parse(filePath: string): Session;
}
