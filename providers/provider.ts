/**
 * Quorum Provider — abstraction layer for IDE/tool integration.
 *
 * Each provider knows how to:
 * 1. Detect events from its native system (hooks, file watch, API polling)
 * 2. Normalize them into QuorumEvents
 * 3. Emit to the bus
 * 4. Execute audits using its preferred auditor
 *
 * The daemon and core protocol never touch provider internals.
 */

import type { QuorumBus } from "../bus/bus.js";
import type { ProviderKind, QuorumEvent } from "../bus/events.js";

// ── Provider interface ────────────────────────────────

export interface QuorumProvider {
  /** Unique identifier: "claude-code", "codex", "cursor", etc. */
  readonly kind: ProviderKind;

  /** Human-readable name for the TUI. */
  readonly displayName: string;

  /** Capabilities this provider supports. */
  readonly capabilities: ProviderCapability[];

  /** Connect to the bus and start producing events. */
  start(bus: QuorumBus, config: ProviderConfig): Promise<void>;

  /** Stop producing events and clean up resources. */
  stop(): Promise<void>;

  /** Current connection/health status. */
  status(): ProviderStatus;
}

export type ProviderCapability =
  | "hooks"           // Native hook system (Claude Code)
  | "file-watch"      // File system watching for changes
  | "api-poll"        // API polling for state changes
  | "worktree"        // Git worktree isolation support
  | "audit"           // Can run audits natively
  | "streaming"       // Supports streaming output
  | "agent-spawn";    // Can spawn sub-agents

export interface ProviderStatus {
  connected: boolean;
  lastEvent?: number;
  activeAgents: number;
  pendingAudits: number;
  error?: string;
}

export interface ProviderConfig {
  /** Working directory for this provider. */
  repoRoot: string;
  /** Watch file path (relative to repoRoot). */
  watchFile: string;
  /** Respond file path (relative to repoRoot). */
  respondFile: string;
  /** Auditor to use for this provider. */
  auditor: AuditorConfig;
  /** Provider-specific options. */
  options?: Record<string, unknown>;
}

// ── Auditor abstraction ───────────────────────────────

export interface AuditorConfig {
  /** Which model/service to use: "codex", "gpt-4o", "claude-opus", "gemini-pro" */
  model: string;
  /** Binary or API endpoint. */
  endpoint?: string;
  /** Timeout in ms. */
  timeout?: number;
}

export interface AuditRequest {
  /** Evidence markdown content. */
  evidence: string;
  /** Prompt template (rendered). */
  prompt: string;
  /** Changed files list. */
  files: string[];
  /** Session context. */
  sessionId?: string;
}

export interface AuditResult {
  verdict: "approved" | "changes_requested" | "infra_failure";
  codes: string[];
  summary: string;
  raw: string;
  duration: number;
}

export interface Auditor {
  /** Run an audit and return the verdict. */
  audit(request: AuditRequest): Promise<AuditResult>;
  /** Check if the auditor is available. */
  available(): Promise<boolean>;
}

// ── Provider registry ─────────────────────────────────

const registry = new Map<ProviderKind, QuorumProvider>();

export function registerProvider(provider: QuorumProvider): void {
  registry.set(provider.kind, provider);
}

export function getProvider(kind: ProviderKind): QuorumProvider | undefined {
  return registry.get(kind);
}

export function listProviders(): QuorumProvider[] {
  return [...registry.values()];
}
