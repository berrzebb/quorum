/**
 * ProviderEventMapper — normalizes provider-native events to ProviderRuntimeEvent.
 *
 * Each provider (Codex App Server, Claude Agent SDK) implements their own mapper.
 * This module provides the interface and a utility factory function.
 */

import type { ProviderRuntimeEvent, ProviderSessionRef } from "./session-runtime.js";

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
