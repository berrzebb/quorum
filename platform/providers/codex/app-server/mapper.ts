/**
 * CodexAppServerMapper — maps Codex App Server JSON-RPC notifications
 * to normalized ProviderRuntimeEvent.
 *
 * @deprecated Since v0.5.0. codex-plugin-cc handles event normalization
 * internally. This mapper will be removed in v0.6.0.
 *
 * Each Codex notification (thread/started, turn/started, item/*, etc.)
 * is mapped 1:1 to a ProviderRuntimeEvent kind. Unknown methods return null.
 *
 * Control-plane integration (SDK-12):
 * - approval_requested: enriched with tool capability metadata (isDestructive, isReadOnly)
 * - item_completed (tool_call kind): annotated with capability info
 */

import type { ProviderRuntimeEvent, ProviderSessionRef } from "../../session-runtime.js";
import type { ProviderEventMapper } from "../../event-mapper.js";
import { createRuntimeEvent } from "../../event-mapper.js";
import { CODEX_NOTIFICATIONS } from "./protocol.js";
import {
  getCapability,
  isDestructive as checkDestructive,
  isReadOnly as checkReadOnly,
  isConcurrencySafe as checkConcurrencySafe,
} from "../../../core/tools/capability-registry.js";

/**
 * Maps Codex App Server JSON-RPC notifications to ProviderRuntimeEvent.
 * Enriches tool-related events with capability metadata from the registry.
 */
export class CodexAppServerMapper implements ProviderEventMapper {
  readonly provider = "codex" as const;

  normalize(raw: Record<string, unknown>, ref: ProviderSessionRef): ProviderRuntimeEvent | null {
    const method = raw.method as string | undefined;
    if (!method) return null;

    const params = (raw.params ?? {}) as Record<string, unknown>;

    switch (method) {
      case CODEX_NOTIFICATIONS.THREAD_STARTED:
        return createRuntimeEvent(ref, "thread_started", params);

      case CODEX_NOTIFICATIONS.TURN_STARTED:
        return createRuntimeEvent(ref, "turn_started", params);

      case CODEX_NOTIFICATIONS.ITEM_STARTED:
        return createRuntimeEvent(ref, "item_started", this.enrichItemPayload(params));

      case CODEX_NOTIFICATIONS.ITEM_DELTA:
        return createRuntimeEvent(ref, "item_delta", params);

      case CODEX_NOTIFICATIONS.ITEM_COMPLETED:
        return createRuntimeEvent(ref, "item_completed", this.enrichItemPayload(params));

      case CODEX_NOTIFICATIONS.TURN_COMPLETED:
        return createRuntimeEvent(ref, "turn_completed", params);

      case CODEX_NOTIFICATIONS.APPROVAL_REQUESTED:
        return createRuntimeEvent(ref, "approval_requested", this.enrichApprovalPayload(params));

      case CODEX_NOTIFICATIONS.SESSION_COMPLETED:
        return createRuntimeEvent(ref, "session_completed", params);

      case CODEX_NOTIFICATIONS.SESSION_FAILED:
        return createRuntimeEvent(ref, "session_failed", params);

      default:
        return null;
    }
  }

  /**
   * Enrich approval_requested payload with tool capability metadata.
   * When the approval is for a tool, adds isDestructive/isReadOnly flags
   * so the gate can make informed decisions without a separate lookup.
   */
  private enrichApprovalPayload(params: Record<string, unknown>): Record<string, unknown> {
    if (params.kind !== "tool") return params;

    const toolName = params.reason as string;
    const cap = getCapability(toolName);
    if (!cap) return params;

    return {
      ...params,
      toolCapability: {
        isDestructive: cap.isDestructive,
        isReadOnly: cap.isReadOnly,
        isConcurrencySafe: cap.isConcurrencySafe,
        category: cap.category,
      },
    };
  }

  /**
   * Enrich item events with tool capability metadata when the item is a tool_call.
   */
  private enrichItemPayload(params: Record<string, unknown>): Record<string, unknown> {
    if (params.kind !== "tool_call") return params;

    // Tool name may be in content or itemId — best-effort extraction
    const toolName = (params.content as string) ?? (params.itemId as string);
    if (!toolName) return params;

    const cap = getCapability(toolName);
    if (!cap) return params;

    return {
      ...params,
      toolCapability: {
        isDestructive: checkDestructive(toolName),
        isReadOnly: checkReadOnly(toolName),
        isConcurrencySafe: checkConcurrencySafe(toolName),
      },
    };
  }
}
