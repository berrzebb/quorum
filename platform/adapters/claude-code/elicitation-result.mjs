#!/usr/bin/env node
/**
 * Claude Code Hook: ElicitationResult
 *
 * Fires after user responds to an MCP elicitation.
 */
import { REPO_ROOT, cfg, configMissing } from "../../core/context.mjs";
import { readStdinJson, withBridge } from "../shared/hook-io.mjs";

if (configMissing) process.exit(0);

const input = await readStdinJson();

await withBridge(REPO_ROOT, cfg.hooks, async (bridge) => {
  await bridge.fireHook("elicitation.result", {
    session_id: input.session_id,
    cwd: REPO_ROOT,
    tool_name: input.tool_name,
    metadata: { elicitation_id: input.elicitation_id, action: input.action },
  });
});
