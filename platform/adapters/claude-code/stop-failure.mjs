#!/usr/bin/env node
/**
 * Hook: StopFailure
 * Fires when the session ends abnormally (crash, timeout, etc.).
 * Saves diagnostic state to the event bus for post-mortem analysis.
 */
import { REPO_ROOT, cfg, configMissing } from "../../core/context.mjs";
import { readStdinJson, withBridge } from "../shared/hook-io.mjs";

if (configMissing) process.exit(0);

try {
  const input = await readStdinJson({ exitOnEmpty: false, fallback: {} });
  const error = input?.error ?? "unknown";

  await withBridge(REPO_ROOT, cfg.hooks, async (bridge) => {
    bridge.emitEvent("session.stop_failure", "claude-code", {
      error,
      timestamp: new Date().toISOString(),
    }, { sessionId: input?.session_id });
  });

  console.error(`[quorum] StopFailure: ${error}`);
} catch (err) {
  // Hook must never block shutdown — fail open
  console.warn(`[stop-failure] hook error: ${err?.message}`);
}
