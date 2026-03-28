/**
 * SessionRuntime — interactive session contract for provider-native runtimes.
 *
 * Additive to the one-shot Auditor interface. Provides long-lived session
 * management for Codex App Server (JSON-RPC) and Claude Agent SDK (in-process).
 *
 * Key design decisions:
 * - ProviderExecutionMode is a string union (not enum) for wire compatibility
 * - ProviderSessionRef is a value object (no methods)
 * - SessionRuntime.poll is optional — streaming providers may push events instead
 * - ProviderToolBridge separates tool config from session lifecycle
 * - ProviderRuntimeFactory is the entry point for creating runtimes
 */

/**
 * Provider execution mode — determines transport and lifecycle semantics.
 */
export type ProviderExecutionMode =
  | "cli_exec"      // current one-shot CLI spawn (codex exec, claude -p)
  | "app_server"    // Codex App Server JSON-RPC over stdio
  | "agent_sdk";    // Claude Agent SDK in-process runtime

/**
 * Reference to a provider-native session/thread.
 */
export interface ProviderSessionRef {
  provider: "codex" | "claude";
  executionMode: ProviderExecutionMode;
  providerSessionId: string;
  threadId?: string;
  turnId?: string;
}

/**
 * Request to start or resume a session runtime.
 */
export interface SessionRuntimeRequest {
  prompt: string;
  cwd: string;
  sessionId: string;        // quorum session id
  contractId?: string;       // sprint contract id
  resumeFrom?: ProviderSessionRef;
  metadata?: Record<string, unknown>;
}

/**
 * Normalized event from provider-native runtime stream.
 */
export interface ProviderRuntimeEvent {
  providerRef: ProviderSessionRef;
  kind:
    | "thread_started"
    | "turn_started"
    | "item_started"
    | "item_delta"
    | "item_completed"
    | "approval_requested"
    | "turn_completed"
    | "session_completed"
    | "session_failed";
  payload: Record<string, unknown>;
  ts: number;
}

/**
 * Approval request from provider-native runtime.
 */
export interface ProviderApprovalRequest {
  providerRef: ProviderSessionRef;
  requestId: string;
  kind: "tool" | "command" | "diff" | "network";
  reason: string;
  scope?: string[];
}

/**
 * Approval decision from quorum gate.
 */
export interface ProviderApprovalDecision {
  requestId: string;
  decision: "allow" | "deny";
  remember?: boolean;
}

/**
 * Interactive session runtime contract — additive to one-shot Auditor.
 */
export interface SessionRuntime {
  readonly provider: "codex" | "claude";
  readonly mode: ProviderExecutionMode;
  start(request: SessionRuntimeRequest): Promise<ProviderSessionRef>;
  resume(ref: ProviderSessionRef, request?: Partial<SessionRuntimeRequest>): Promise<void>;
  send(ref: ProviderSessionRef, input: string): Promise<void>;
  stop(ref: ProviderSessionRef): Promise<void>;
  poll?(ref: ProviderSessionRef): Promise<ProviderRuntimeEvent[]>;
  status(ref: ProviderSessionRef): Promise<"running" | "completed" | "failed" | "detached">;
}

/**
 * Tool bridge for provider-native tool loops.
 */
export interface ProviderToolBridge {
  provider: "codex" | "claude";
  buildToolConfig(input: {
    repoRoot: string;
    contractId?: string;
    allowedTools: string[];
  }): Promise<Record<string, unknown>>;
}

/**
 * Factory for creating provider runtimes based on execution mode.
 */
export interface ProviderRuntimeFactory {
  createCodexRuntime(mode: "cli_exec" | "app_server"): SessionRuntime;
  createClaudeRuntime(mode: "cli_exec" | "agent_sdk"): SessionRuntime;
}
