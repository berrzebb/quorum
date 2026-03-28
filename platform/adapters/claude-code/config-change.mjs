#!/usr/bin/env node
/**
 * Claude Code Hook: ConfigChange
 *
 * Fires when a configuration file changes during a session.
 * Can block config changes (except policy_settings).
 */
import { REPO_ROOT, cfg, configMissing } from "../../core/context.mjs";
import { readStdinJson, withBridge } from "../shared/hook-io.mjs";

if (configMissing) process.exit(0);

const input = await readStdinJson();

await withBridge(REPO_ROOT, cfg.hooks, async (bridge) => {
  const gate = await bridge.checkHookGate("config.change", {
    session_id: input.session_id,
    cwd: REPO_ROOT,
    metadata: { source: input.source, file_path: input.file_path },
  });
  if (!gate.allowed) {
    process.stdout.write(JSON.stringify({
      decision: "block",
      reason: gate.reason,
    }));
  }
});
