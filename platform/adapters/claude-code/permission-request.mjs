#!/usr/bin/env node
/**
 * Claude Code Hook: PermissionRequest
 *
 * Fires when a permission dialog appears. Can auto-allow or deny.
 */
import { REPO_ROOT, cfg, configMissing } from "../../core/context.mjs";
import { readStdinJson, withBridge } from "../shared/hook-io.mjs";

if (configMissing) process.exit(0);

const input = await readStdinJson();

await withBridge(REPO_ROOT, cfg.hooks, async (bridge) => {
  const gate = await bridge.checkHookGate("permission.request", {
    session_id: input.session_id,
    cwd: REPO_ROOT,
    tool_name: input.tool_name,
    tool_input: input.tool_input,
  });
  if (!gate.allowed) {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PermissionRequest",
        decision: { behavior: "deny", message: gate.reason },
      },
    }));
  }
});
