#!/usr/bin/env node
/* global process, Buffer */

/**
 * TeammateIdle hook: quality gate before a teammate goes idle.
 *
 * Only fires when CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 is set.
 * Runs CQ (lint + tsc) checks on changed files.
 *
 * Exit codes:
 *   0 — pass (teammate may go idle)
 *   2 — feedback (teammate continues working with the feedback message)
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { runQualityChecks } from "./run-quality-checks.mjs";

// ── Read stdin ───────────────────────────────────────────────
let input;
try {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) process.exit(0);
  input = JSON.parse(raw);
} catch (err) {
  console.warn(`[teammate-idle] stdin parse error: ${err?.message}`);
  process.exit(0);
}

const teammateName = input.teammate_name || "";

// Only gate implementer teammates
if (!teammateName.includes("implementer")) {
  process.exit(0);
}

// ── Resolve repo root ────────────────────────────────────────
let REPO_ROOT;
try {
  REPO_ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8", windowsHide: true }).trim();
} catch (err) {
  console.warn(`[teammate-idle] git rev-parse failed: ${err?.message}`);
  REPO_ROOT = process.cwd();
}

// ── Check for uncommitted or staged changes ──────────────────
let changedFiles = [];
try {
  const unstaged = execFileSync("git", ["diff", "--name-only"], { cwd: REPO_ROOT, encoding: "utf8", windowsHide: true }).trim();
  const staged = execFileSync("git", ["diff", "--cached", "--name-only"], { cwd: REPO_ROOT, encoding: "utf8", windowsHide: true }).trim();
  const combined = `${unstaged}\n${staged}`.trim();
  if (combined) {
    changedFiles = [...new Set(combined.split(/\r?\n/).filter(Boolean))];
  }
} catch (err) { console.warn(`[teammate-idle] git diff failed: ${err?.message}`); }

if (changedFiles.length === 0) {
  // No changes to validate — allow idle
  process.exit(0);
}

// ── Run quality checks (language-aware) ──────────────────────
let quorumConfig = null;
try {
  const configPath = resolve(REPO_ROOT, ".claude", "quorum", "config.json");
  if (existsSync(configPath)) {
    quorumConfig = JSON.parse(readFileSync(configPath, "utf8"));
  }
} catch (err) { console.warn(`[teammate-idle] config read error: ${err?.message}`); }

const failures = runQualityChecks({ config: quorumConfig, repoRoot: REPO_ROOT, changedFiles });

// ── Verdict ──────────────────────────────────────────────────
if (failures.length > 0) {
  const feedback = [
    `⚠️ Quality gate failed (${failures.length} issue${failures.length > 1 ? "s" : ""}).`,
    `Fix before going idle:`,
    "",
    ...failures,
  ].join("\n");

  process.stderr.write(feedback);
  process.exit(2); // Exit 2 = feedback, teammate continues
}

process.exit(0); // All checks passed — allow idle
