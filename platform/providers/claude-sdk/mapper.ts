/**
 * Claude SDK Event Mapper — normalizes Claude SDK events to ProviderRuntimeEvent.
 *
 * Maps Claude Agent SDK session/message/tool events into the unified
 * ProviderRuntimeEvent format used by the quorum bus.
 *
 * @module providers/claude-sdk/mapper
 */

import type { ProviderRuntimeEvent, ProviderSessionRef } from "../session-runtime.js";
import type { ProviderEventMapper } from "../event-mapper.js";
import { createRuntimeEvent } from "../event-mapper.js";

/**
 * Maps Claude SDK events to normalized ProviderRuntimeEvent.
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
        return createRuntimeEvent(ref, "item_started", { kind: "tool_call", ...raw });
      case "content_block_delta":
        return createRuntimeEvent(ref, "item_delta", raw);
      case "tool_use_complete":
        return createRuntimeEvent(ref, "item_completed", { kind: "tool_call", ...raw });
      case "message_complete":
        return createRuntimeEvent(ref, "turn_completed", raw);
      case "permission_request":
        return createRuntimeEvent(ref, "approval_requested", raw);
      case "session_complete":
        return createRuntimeEvent(ref, "session_completed", raw);
      case "session_error":
        return createRuntimeEvent(ref, "session_failed", raw);
      default:
        return null;
    }
  }
}
