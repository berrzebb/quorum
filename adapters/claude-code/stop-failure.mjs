#!/usr/bin/env node
/**
 * Hook: StopFailure
 * Fires when the session ends abnormally (crash, timeout, etc.).
 * Saves diagnostic state to the event bus for post-mortem analysis.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

try {
  const input = JSON.parse(readFileSync("/dev/stdin", "utf8"));
  const error = input?.error ?? "unknown";

  // Emit event to bus if available
  const bridgePath = resolve(__dirname, "..", "..", "core", "bridge.mjs");
  if (existsSync(bridgePath)) {
    const bridge = await import(bridgePath);
    if (bridge.emitEvent) {
      bridge.emitEvent("session.stop_failure", {
        error,
        timestamp: new Date().toISOString(),
        sessionId: input?.session_id,
      });
    }
    // Attempt graceful cleanup
    if (bridge.close) bridge.close();
  }

  console.error(`[quorum] StopFailure: ${error}`);
} catch {
  // Hook must never block shutdown — fail silently
}
