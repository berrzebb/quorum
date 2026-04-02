#!/usr/bin/env node
/**
 * Codex CLI Hook: SessionStart
 *
 * Loads audit state + recent changes as context for new sessions.
 * Uses shared modules — same business logic as Claude Code & Gemini.
 *
 * Codex CLI protocol: stdout text is injected into model context.
 * Requires: codex -c features.codex_hooks=true
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";

import { createHookContext, withBridge } from "../../../shared/hook-io.mjs";
import { extractTags } from "../../../shared/config-resolver.mjs";
import { buildResumeState } from "../../../shared/audit-state.mjs";
import { buildContextReinforcement } from "../../../shared/context-reinforcement.mjs";

const { ADAPTER_DIR, REPO_ROOT, cfg, configMissing } = createHookContext(import.meta.url);

if (configMissing) {
  process.stdout.write("[quorum] config.json not found. Run: quorum setup\n");
  process.exit(0);
}

const { agreeTag } = extractTags(cfg);
let context = "";

// ── 1. Recent git commits ───────────────────────────────────
try {
  const commits = execFileSync("git", ["log", "--oneline", "-10"], {
    cwd: REPO_ROOT, encoding: "utf8", windowsHide: true,
  }).trim();
  if (commits) context += `Recent commits:\n${commits}\n\n`;
} catch (err) { console.warn(`[codex-session-start] git log failed: ${err?.message}`); }

// ── 2. Resume detection ─────────────────────────────────────
const { resumeActions, contextLines } = buildResumeState({
  repoRoot: REPO_ROOT,
  adapterDir: ADAPTER_DIR,
  cfg,
  handoffContent: "",
});

for (const line of contextLines) context += `${line}\n`;

if (resumeActions.length > 0) {
  context += `\n${"=".repeat(50)}\n`;
  context += `[RESUME REQUIRED — ${resumeActions.length} action(s)]\n`;
  context += `${"=".repeat(50)}\n\n`;
  for (let i = 0; i < resumeActions.length; i++) {
    context += `${i + 1}. ${resumeActions[i]}\n\n`;
  }
}

// ── 3. Context reinforcement ─────────────────────────────────
const locale = cfg.plugin?.locale ?? "en";
const quorumRoot = resolve(ADAPTER_DIR, "..", "..");
const reinforcement = buildContextReinforcement({ adapterRoot: quorumRoot, locale, agreeTag });
if (reinforcement) context += `\n${reinforcement}\n`;

// ── 4. Fire user-defined hooks ───────────────────────────────
await withBridge(REPO_ROOT, cfg.hooks, async (bridge) => {
  await bridge.hooks.fireHook("session.start", {
    cwd: REPO_ROOT, metadata: { provider: "codex" },
  });
});

// ── Output (Codex protocol: stdout → model context) ─────────
if (context.trim()) {
  process.stdout.write(context);
}
