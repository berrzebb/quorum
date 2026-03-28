#!/usr/bin/env node
/**
 * Claude Code Hook: InstructionsLoaded
 *
 * Fires when CLAUDE.md or .claude/rules/*.md files are loaded into context.
 * Observability only — cannot block instruction loading.
 */
import { REPO_ROOT, cfg, configMissing } from "../../core/context.mjs";
import { readStdinJson, withBridge } from "../shared/hook-io.mjs";

if (configMissing) process.exit(0);

const input = await readStdinJson();

await withBridge(REPO_ROOT, cfg.hooks, async (bridge) => {
  await bridge.fireHook("instructions.loaded", {
    session_id: input.session_id,
    cwd: REPO_ROOT,
    metadata: {
      file_path: input.file_path,
      memory_type: input.memory_type,
      load_reason: input.load_reason,
    },
  });
});
