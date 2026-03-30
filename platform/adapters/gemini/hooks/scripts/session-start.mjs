#!/usr/bin/env node
/**
 * Gemini CLI Hook: SessionStart
 *
 * Loads audit state + recent changes as context for new sessions.
 * Mirrors adapters/claude-code/session-start.mjs but uses shared modules.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { resolveRepoRoot } from "../../../shared/repo-resolver.mjs";
import { loadConfig, extractTags } from "../../../shared/config-resolver.mjs";
import { buildResumeState } from "../../../shared/audit-state.mjs";
import { firstRunSetup, buildFirstRunMessage } from "../../../shared/first-run.mjs";
import { buildContextReinforcement } from "../../../shared/context-reinforcement.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ADAPTER_DIR = resolve(__dirname, "..");

// Set adapter root env for downstream modules
process.env.GEMINI_EXTENSION_ROOT = ADAPTER_DIR;

const REPO_ROOT = resolveRepoRoot({ adapterDir: __dirname });
const { cfg, configPath, configMissing } = loadConfig({ repoRoot: REPO_ROOT, adapterDir: ADAPTER_DIR });

// ── First-run setup ──────────────────────────────────────────
if (configMissing) {
  const adapterRoot = ADAPTER_DIR;
  const projectConfigDir = resolve(REPO_ROOT, ".claude", "quorum");
  const result = firstRunSetup({ adapterRoot, projectConfigDir });
  const msg = buildFirstRunMessage(result, resolve(adapterRoot, "README.md"));
  if (msg) {
    process.stdout.write(JSON.stringify({
      systemMessage: msg,
      hookSpecificOutput: { additionalContext: msg },
    }));
    process.exit(0);
  }
}

const { triggerTag, agreeTag, pendingTag } = extractTags(cfg);

let context = "";

// ── 1. Recent git commits ───────────────────────────────────
try {
  const commits = execFileSync("git", ["log", "--oneline", "-10"], {
    cwd: REPO_ROOT, encoding: "utf8", windowsHide: true,
  }).trim();
  if (commits) context += `Recent commits:\n${commits}\n\n`;
} catch (err) { console.warn(`[gemini-session-start] git log failed: ${err?.message}`); }

// ── 2. Resume detection ─────────────────────────────────────
const handoffFile = cfg.plugin?.handoff_file ?? ".claude/session-handoff.md";
const handoffPath = resolve(REPO_ROOT, handoffFile);
let handoffContent = "";
if (existsSync(handoffPath)) {
  try { handoffContent = readFileSync(handoffPath, "utf8").trim(); } catch (err) { console.warn(`[gemini-session-start] handoff read failed: ${err?.message}`); }
  if (handoffContent) context += `Session Handoff:\n${handoffContent}\n\n`;
}

const { resumeActions, contextLines } = buildResumeState({
  repoRoot: REPO_ROOT,
  adapterDir: ADAPTER_DIR,
  cfg,
  handoffContent,
});

for (const line of contextLines) {
  context += `${line}\n`;
}

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
// Try adapter docs first, then quorum root docs
const adapterRoot = process.env.QUORUM_ADAPTER_ROOT ?? ADAPTER_DIR;
const quorumRoot = resolve(ADAPTER_DIR, "..", "..");
const reinforcement = buildContextReinforcement({ adapterRoot: quorumRoot, locale, agreeTag })
  ?? buildContextReinforcement({ adapterRoot, locale, agreeTag });

if (reinforcement) {
  context += `\n${reinforcement}\n`;
}

// ── Output (Gemini hook protocol: JSON only on stdout) ──────
if (context.trim()) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      additionalContext: context.trim(),
    },
  }));
}
