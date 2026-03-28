/**
 * Codex App Server JSON-RPC protocol types.
 * Based on the official Codex App Server specification.
 *
 * Wire format: NDJSON over stdio (one JSON object per line).
 * See also: platform/adapters/shared/jsonrpc-client.mjs for the MJS client.
 */

// ─── Request/Response base ──────────────────────

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number | string;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number | string | null;
  result?: unknown;
  error?: JsonRpcError;
}

export interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

// ─── Lifecycle types ────────────────────────────

export interface ThreadRef {
  threadId: string;
}

export interface TurnRef extends ThreadRef {
  turnId: string;
}

export interface ItemRef extends TurnRef {
  itemId: string;
}

export type ItemKind = "message" | "tool_call" | "tool_result" | "file_edit" | "command";

export type ItemStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

// ─── Server → Client notifications ─────────────

export interface ThreadStartedParams extends ThreadRef {
  createdAt: number;
}

export interface TurnStartedParams extends TurnRef {
  role: "assistant" | "system";
}

export interface ItemStartedParams extends ItemRef {
  kind: ItemKind;
}

export interface ItemDeltaParams extends ItemRef {
  delta: string;
}

export interface ItemCompletedParams extends ItemRef {
  kind: ItemKind;
  status: ItemStatus;
  content?: string;
}

export interface TurnCompletedParams extends TurnRef {
  itemCount: number;
}

export interface ApprovalRequestParams {
  requestId: string;
  threadId: string;
  kind: "tool" | "command" | "diff" | "network";
  reason: string;
  scope?: string[];
}

export interface SessionCompletedParams extends ThreadRef {
  summary?: string;
}

export interface SessionFailedParams extends ThreadRef {
  error: string;
}

// ─── Client → Server requests ───────────────────

export interface InitializeParams {
  clientName: string;
  clientVersion: string;
  capabilities?: Record<string, unknown>;
}

export interface InitializeResult {
  serverName: string;
  serverVersion: string;
  capabilities: Record<string, unknown>;
}

export interface CreateThreadParams {
  prompt: string;
  cwd: string;
  model?: string;
  metadata?: Record<string, unknown>;
}

export interface SendInputParams {
  threadId: string;
  input: string;
}

export interface ApprovalResponseParams {
  requestId: string;
  decision: "allow" | "deny";
}

export interface StopThreadParams {
  threadId: string;
}

export interface ThreadStatusParams {
  threadId: string;
}

export type ThreadStatus = "running" | "completed" | "failed" | "stopped";

// ─── Notification method names ──────────────────

export const CODEX_NOTIFICATIONS = {
  THREAD_STARTED: "thread/started",
  TURN_STARTED: "turn/started",
  ITEM_STARTED: "item/started",
  ITEM_DELTA: "item/delta",
  ITEM_COMPLETED: "item/completed",
  TURN_COMPLETED: "turn/completed",
  APPROVAL_REQUESTED: "approval/requested",
  SESSION_COMPLETED: "session/completed",
  SESSION_FAILED: "session/failed",
} as const;

export const CODEX_METHODS = {
  INITIALIZE: "initialize",
  CREATE_THREAD: "thread/create",
  SEND_INPUT: "thread/sendInput",
  APPROVAL_RESPONSE: "approval/response",
  STOP_THREAD: "thread/stop",
  THREAD_STATUS: "thread/status",
} as const;
