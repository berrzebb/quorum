#!/usr/bin/env node
/**
 * Gemini CLI Hook: PreCompress — state snapshot before context compression.
 */
import { createHookContext, withBridge } from "../../../shared/hook-io.mjs";

const { REPO_ROOT, cfg, configMissing } = createHookContext(import.meta.url);
if (configMissing) process.exit(0);

await withBridge(REPO_ROOT, cfg.hooks, async (bridge) => {
  await bridge.fireHook("session.compress", {
    cwd: REPO_ROOT, metadata: { provider: "gemini" },
  });
});
