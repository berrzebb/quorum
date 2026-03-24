#!/usr/bin/env node
/**
 * Claude Code Hook: Elicitation
 *
 * Fires when an MCP server requests user input during a tool call.
 */
import { REPO_ROOT, cfg, configMissing } from "../../core/context.mjs";
import { readStdinJson, withBridge } from "../shared/hook-io.mjs";

if (configMissing) process.exit(0);

const input = await readStdinJson();

await withBridge(REPO_ROOT, cfg.hooks, async (bridge) => {
  await bridge.fireHook("elicitation", {
    session_id: input.session_id,
    cwd: REPO_ROOT,
    tool_name: input.tool_name,
    metadata: { elicitation_id: input.elicitation_id, message: input.message },
  });
});
