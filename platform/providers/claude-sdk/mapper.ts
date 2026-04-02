/**
 * Claude SDK Event Mapper — normalizes Claude SDK events to ProviderRuntimeEvent.
 *
 * Maps Claude Agent SDK session/message/tool events into the unified
 * ProviderRuntimeEvent format used by the quorum bus.
 *
 * SDK-14: Events are enriched with tool capability metadata from the registry,
 * producing standardized payload shapes. The upper
 * control plane sees identical event structures regardless of provider.
 *
 * @module providers/claude-sdk/mapper
 */

import type { ProviderRuntimeEvent, ProviderSessionRef } from "../session-runtime.js";
import type { ProviderEventMapper } from "../event-mapper.js";
import { createRuntimeEvent } from "../event-mapper.js";
import { getCapability } from "../../core/tools/capability-registry.js";

/**
 * Maps Claude SDK events to normalized ProviderRuntimeEvent.
 * Enriches tool-related events with capability metadata.
 */
export class ClaudeSdkEventMapper implements ProviderEventMapper {
  readonly provider = "claude" as const;

  normalize(raw: Record<string, unknown>, ref: ProviderSessionRef): ProviderRuntimeEvent | null {
    const type = raw.type as string | undefined;
    if (!type) return null;

    switch (type) {
      case "session_start":
        return createRuntimeEvent(ref, "thread_started", raw);
      case "message_start":
        return createRuntimeEvent(ref, "turn_started", raw);
      case "tool_use_start":
        return createRuntimeEvent(ref, "item_started", this.enrichToolPayload({ kind: "tool_call", ...raw }));
      case "content_block_delta":
        return createRuntimeEvent(ref, "item_delta", raw);
      case "tool_use_complete":
        return createRuntimeEvent(ref, "item_completed", this.enrichToolPayload({ kind: "tool_call", ...raw }));
      case "message_complete":
        return createRuntimeEvent(ref, "turn_completed", raw);
      case "permission_request":
        return createRuntimeEvent(ref, "approval_requested", this.enrichApprovalPayload(raw));
      case "session_complete":
        return createRuntimeEvent(ref, "session_completed", raw);
      case "session_error":
        return createRuntimeEvent(ref, "session_failed", raw);
      default:
        return null;
    }
  }

  /** Enrich tool events with capability metadata. */
  private enrichToolPayload(payload: Record<string, unknown>): Record<string, unknown> {
    const toolName = (payload.name ?? payload.tool_name) as string | undefined;
    if (!toolName) return payload;

    const cap = getCapability(toolName);
    if (!cap) return payload;

    return {
      ...payload,
      toolCapability: {
        isDestructive: cap.isDestructive,
        isReadOnly: cap.isReadOnly,
        isConcurrencySafe: cap.isConcurrencySafe,
        category: cap.category,
      },
    };
  }

  /** Enrich permission_request with capability metadata. */
  private enrichApprovalPayload(payload: Record<string, unknown>): Record<string, unknown> {
    const toolName = (payload.name ?? payload.reason ?? payload.tool_name) as string | undefined;
    if (!toolName) return payload;

    const cap = getCapability(toolName);
    if (!cap) return payload;

    return {
      ...payload,
      kind: payload.kind ?? "tool",
      requestId: payload.requestId ?? payload.request_id ?? `req-${Date.now()}`,
      reason: payload.reason ?? toolName,
      toolCapability: {
        isDestructive: cap.isDestructive,
        isReadOnly: cap.isReadOnly,
        isConcurrencySafe: cap.isConcurrencySafe,
        category: cap.category,
      },
    };
  }
}
