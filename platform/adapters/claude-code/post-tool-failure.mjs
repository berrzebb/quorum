#!/usr/bin/env node
/**
 * Hook: PostToolUseFailure
 * Fires when a tool call fails. Tracks repeated failures for stagnation detection.
 */
import { REPO_ROOT, cfg, configMissing } from "../../core/context.mjs";
import { readStdinJson, withBridge } from "../shared/hook-io.mjs";

if (configMissing) process.exit(0);

try {
  const input = await readStdinJson({ exitOnEmpty: false, fallback: {} });
  const toolName = input?.tool_name ?? "unknown";
  const error = input?.error ?? "";

  await withBridge(REPO_ROOT, cfg.hooks, async (bridge) => {
    bridge.event.emitEvent("tool.failure", "claude-code", {
      tool: toolName,
      error: typeof error === "string" ? error.slice(0, 500) : String(error).slice(0, 500),
    }, { sessionId: input?.session_id });
    await bridge.hooks.fireHook("tool.failure", {
      session_id: input?.session_id,
      cwd: REPO_ROOT,
      tool_name: toolName,
      metadata: { error },
    });
  });
} catch (err) {
  // Hook must never block — fail open
  console.warn(`[post-tool-failure] hook error: ${err?.message}`);
}
