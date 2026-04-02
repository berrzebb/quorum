#!/usr/bin/env node
/**
 * Claude Code Hook: Notification
 *
 * Fires when Claude Code sends a notification (permission_prompt, idle_prompt, etc.).
 * Observability only — cannot block notifications.
 */
import { REPO_ROOT, cfg, configMissing } from "../../core/context.mjs";
import { readStdinJson, withBridge } from "../shared/hook-io.mjs";

if (configMissing) process.exit(0);

const input = await readStdinJson();

await withBridge(REPO_ROOT, cfg.hooks, async (bridge) => {
  bridge.event.emitEvent("notification", "claude-code", {
    type: input.notification_type,
    message: input.message,
  }, { sessionId: input.session_id });
  await bridge.hooks.fireHook("notification", {
    session_id: input.session_id,
    cwd: REPO_ROOT,
    metadata: { type: input.notification_type, message: input.message },
  });
});
