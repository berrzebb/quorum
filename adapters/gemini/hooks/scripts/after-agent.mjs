#!/usr/bin/env node
/**
 * Gemini CLI Hook: AfterAgent — quality checks + retro detection.
 */
import { createHookContext, readStdinJson, withBridge } from "../../../shared/hook-io.mjs";

const { REPO_ROOT, cfg, configMissing } = createHookContext(import.meta.url);
if (configMissing) process.exit(0);

await readStdinJson({ exitOnEmpty: false, fallback: {} });

await withBridge(REPO_ROOT, cfg.hooks, async (bridge) => {
  await bridge.fireHook("agent.complete", {
    cwd: REPO_ROOT, metadata: { provider: "gemini" },
  });
});
