#!/usr/bin/env node
/**
 * Codex CLI Hook: Stop — cleanup on session end.
 */
import { createHookContext, readStdinJson, withBridge } from "../../../shared/hook-io.mjs";

const { REPO_ROOT, cfg, configMissing } = createHookContext(import.meta.url);
if (configMissing) process.exit(0);

const input = await readStdinJson({ exitOnEmpty: false, fallback: {} });

await withBridge(REPO_ROOT, cfg.hooks, async (bridge) => {
  bridge.event.emitEvent("session.stop", "codex", {}, { sessionId: input.session_id });
  await bridge.hooks.fireHook("session.end", {
    session_id: input.session_id, cwd: REPO_ROOT,
    metadata: { provider: "codex" },
  });
});
