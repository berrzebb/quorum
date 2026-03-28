#!/usr/bin/env node
/**
 * Claude Code Hook: SessionEnd
 *
 * Fires when a session terminates. Best-effort cleanup.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { REPO_ROOT, cfg, configMissing } from "../../core/context.mjs";
import { readStdinJson, withBridge } from "../shared/hook-io.mjs";
import { gitSync } from "../../core/cli-runner.mjs";

if (configMissing) process.exit(0);

const input = await readStdinJson({ exitOnEmpty: false, fallback: {} });

// Stage session artifacts
const artifacts = [".claude/CLAUDE.md"];
for (const f of artifacts) {
  if (existsSync(resolve(REPO_ROOT, f))) {
    gitSync(["add", f], { cwd: REPO_ROOT });
  }
}

await withBridge(REPO_ROOT, cfg.hooks, async (bridge) => {
  await bridge.fireHook("session.end", {
    session_id: input.session_id,
    cwd: REPO_ROOT,
    metadata: { reason: input.reason },
  });
});
