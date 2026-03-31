/**
 * ProviderEventMapper — normalizes provider-native events to ProviderRuntimeEvent.
 *
 * Each provider (Codex App Server, Claude Agent SDK) implements their own mapper.
 * This module provides the interface, utility functions, and standard payload shapes.
 *
 * SDK-14: Standard payload shapes ensure the upper control plane sees identical
 * event structures regardless of provider transport. Provider differences are
 * confined to the mapper layer; everything above sees StandardPayload shapes.
 */

import type { ProviderRuntimeEvent, ProviderSessionRef } from "./session-runtime.js";

// ── Standard payload shapes ──────────────────────────

/** Capability metadata attached to tool-related events. */
export interface ToolCapabilityAnnotation {
  isDestructive: boolean;
  isReadOnly: boolean;
  isConcurrencySafe: boolean;
  category?: string;
}

/** Standard payload for approval_requested events (provider-agnostic). */
export interface ApprovalPayload {
  requestId: string;
  kind: "tool" | "command" | "diff" | "network";
  reason: string;
  scope?: string[];
  toolCapability?: ToolCapabilityAnnotation;
}

/** Standard payload for item events (item_started, item_completed). */
export interface ItemPayload {
  itemId?: string;
  kind?: "message" | "tool_call" | "tool_result" | "file_edit" | "command";
  status?: string;
  content?: string;
  toolCapability?: ToolCapabilityAnnotation;
}

/** Standard payload for session terminal events. */
export interface SessionTerminalPayload {
  summary?: string;
  error?: string;
}

// ── ProviderEventMapper interface ──────────────────

/**
 * Maps provider-native events to normalized ProviderRuntimeEvent.
 * Each provider (codex app-server, claude sdk) implements their own mapper.
 */
export interface ProviderEventMapper {
  readonly provider: "codex" | "claude";
  /**
   * Normalize a raw provider event into a ProviderRuntimeEvent.
   */
  normalize(raw: Record<string, unknown>, ref: ProviderSessionRef): ProviderRuntimeEvent | null;
}

// ── Factory utility ─────────────────────────────────

/**
 * Creates a timestamp-based ProviderRuntimeEvent (utility).
 */
export function createRuntimeEvent(
  ref: ProviderSessionRef,
  kind: ProviderRuntimeEvent["kind"],
  payload: Record<string, unknown> = {}
): ProviderRuntimeEvent {
  return { providerRef: ref, kind, payload, ts: Date.now() };
}

// ── Standard normalization ──────────────────────────

/**
 * Extract standard approval payload from any provider's raw event payload.
 * Returns a consistently-shaped ApprovalPayload regardless of source provider.
 */
export function extractApprovalPayload(payload: Record<string, unknown>): ApprovalPayload {
  return {
    requestId: (payload.requestId ?? payload.request_id ?? `req-${Date.now()}`) as string,
    kind: (payload.kind ?? "tool") as ApprovalPayload["kind"],
    reason: (payload.reason ?? payload.name ?? "") as string,
    scope: payload.scope as string[] | undefined,
    toolCapability: payload.toolCapability as ToolCapabilityAnnotation | undefined,
  };
}

/**
 * Extract standard item payload from any provider's raw event payload.
 */
export function extractItemPayload(payload: Record<string, unknown>): ItemPayload {
  return {
    itemId: (payload.itemId ?? payload.item_id) as string | undefined,
    kind: (payload.kind ?? undefined) as ItemPayload["kind"],
    status: payload.status as string | undefined,
    content: payload.content as string | undefined,
    toolCapability: payload.toolCapability as ToolCapabilityAnnotation | undefined,
  };
}

/**
 * Extract standard session terminal payload.
 */
export function extractTerminalPayload(payload: Record<string, unknown>): SessionTerminalPayload {
  return {
    summary: payload.summary as string | undefined,
    error: (payload.error ?? payload.message) as string | undefined,
  };
}

// ── Daemon state projection ─────────────────────────

/**
 * Session state as projected to the daemon store from runtime events.
 * Provider-agnostic: both Codex and Claude events produce the same shape.
 */
export interface ProjectedSessionState {
  provider: "codex" | "claude";
  providerSessionId: string;
  status: "running" | "completed" | "failed" | "idle";
  turnCount: number;
  itemCount: number;
  pendingApprovals: number;
  lastEventKind?: ProviderRuntimeEvent["kind"];
  lastEventTs?: number;
  hasCapabilityEnrichment: boolean;
}

/**
 * Project a sequence of events into a daemon-ready state snapshot.
 * Used by daemon store subscribers to derive UI state from event streams.
 *
 * Completely provider-agnostic: same function for Codex and Claude events.
 */
export function projectEventsToState(
  events: ProviderRuntimeEvent[],
  existing?: Partial<ProjectedSessionState>,
): ProjectedSessionState {
  const state: ProjectedSessionState = {
    provider: existing?.provider ?? "codex",
    providerSessionId: existing?.providerSessionId ?? "",
    status: existing?.status ?? "idle",
    turnCount: existing?.turnCount ?? 0,
    itemCount: existing?.itemCount ?? 0,
    pendingApprovals: existing?.pendingApprovals ?? 0,
    lastEventKind: existing?.lastEventKind,
    lastEventTs: existing?.lastEventTs,
    hasCapabilityEnrichment: existing?.hasCapabilityEnrichment ?? false,
  };

  for (const event of events) {
    state.provider = event.providerRef.provider;
    state.providerSessionId = event.providerRef.providerSessionId;
    state.lastEventKind = event.kind;
    state.lastEventTs = event.ts;

    switch (event.kind) {
      case "thread_started":
        state.status = "running";
        break;
      case "turn_started":
        state.turnCount++;
        break;
      case "item_started":
        state.itemCount++;
        break;
      case "approval_requested":
        state.pendingApprovals++;
        break;
      case "session_completed":
        state.status = "completed";
        break;
      case "session_failed":
        state.status = "failed";
        break;
    }

    // Track whether capability enrichment is present
    if (event.payload.toolCapability) {
      state.hasCapabilityEnrichment = true;
    }
  }

  return state;
}
