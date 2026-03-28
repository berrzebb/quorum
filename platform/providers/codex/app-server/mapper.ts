/**
 * CodexAppServerMapper — maps Codex App Server JSON-RPC notifications
 * to normalized ProviderRuntimeEvent.
 *
 * Each Codex notification (thread/started, turn/started, item/*, etc.)
 * is mapped 1:1 to a ProviderRuntimeEvent kind. Unknown methods return null.
 */

import type { ProviderRuntimeEvent, ProviderSessionRef } from "../../session-runtime.js";
import type { ProviderEventMapper } from "../../event-mapper.js";
import { createRuntimeEvent } from "../../event-mapper.js";
import { CODEX_NOTIFICATIONS } from "./protocol.js";

/**
 * Maps Codex App Server JSON-RPC notifications to ProviderRuntimeEvent.
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
        return createRuntimeEvent(ref, "item_started", params);

      case CODEX_NOTIFICATIONS.ITEM_DELTA:
        return createRuntimeEvent(ref, "item_delta", params);

      case CODEX_NOTIFICATIONS.ITEM_COMPLETED:
        return createRuntimeEvent(ref, "item_completed", params);

      case CODEX_NOTIFICATIONS.TURN_COMPLETED:
        return createRuntimeEvent(ref, "turn_completed", params);

      case CODEX_NOTIFICATIONS.APPROVAL_REQUESTED:
        return createRuntimeEvent(ref, "approval_requested", params);

      case CODEX_NOTIFICATIONS.SESSION_COMPLETED:
        return createRuntimeEvent(ref, "session_completed", params);

      case CODEX_NOTIFICATIONS.SESSION_FAILED:
        return createRuntimeEvent(ref, "session_failed", params);

      default:
        return null;
    }
  }
}
