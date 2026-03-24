#!/usr/bin/env node
/**
 * Gemini CLI Hook: BeforeAgent
 *
 * Injects real-time audit/retro status into the agent context.
 * Equivalent to Claude Code's UserPromptSubmit hook.
 */
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { resolveRepoRoot } from "../../../shared/repo-resolver.mjs";
import { loadConfig } from "../../../shared/config-resolver.mjs";
import { buildStatusSignals } from "../../../shared/audit-state.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ADAPTER_DIR = resolve(__dirname, "..");
const REPO_ROOT = resolveRepoRoot({ adapterDir: __dirname });
const { cfg } = loadConfig({ repoRoot: REPO_ROOT, adapterDir: ADAPTER_DIR });

const signals = buildStatusSignals({ repoRoot: REPO_ROOT, adapterDir: ADAPTER_DIR, cfg });

if (signals.length === 0) process.exit(0);

// Gemini protocol: JSON only on stdout
process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    additionalContext: `[quorum status] ${signals.join(" | ")}`,
  },
}));
