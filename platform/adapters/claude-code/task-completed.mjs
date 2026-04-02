#!/usr/bin/env node
/* global process, Buffer */

/**
 * TaskCompleted hook: enforce done-criteria before task completion.
 *
 * Only fires when CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 is set.
 * Runs structural quality checks (CQ + T) and blocks completion if any fail.
 *
 * Exit codes:
 *   0 — pass (task may be completed)
 *   2 — feedback (task stays in-progress, teammate continues with feedback)
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { execSync } from "node:child_process";
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
  console.warn(`[task-completed] stdin parse error: ${err?.message}`);
  process.exit(0);
}

const taskSubject = input.task_subject || "(unknown)";
const teammateName = input.teammate_name || "";

console.error(`[task-completed] Verifying: "${taskSubject}" by ${teammateName}`);

// ── Resolve repo root ────────────────────────────────────────
let REPO_ROOT;
try {
  REPO_ROOT = execSync("git rev-parse --show-toplevel", { encoding: "utf8", windowsHide: true }).trim();
} catch (err) {
  console.warn(`[task-completed] git rev-parse failed: ${err?.message}`);
  REPO_ROOT = process.cwd();
}

// ── Detect changed files (staged + unstaged + recent commits) ─
let changedFiles = [];
try {
  // Uncommitted changes
  const uncommitted = execSync("git diff --name-only && git diff --cached --name-only", {
    cwd: REPO_ROOT, encoding: "utf8", shell: process.platform === "win32" ? process.env.COMSPEC || "cmd.exe" : true, windowsHide: true,
  }).trim();

  // Recent commits (last 5) — covers worktree commit workflow
  let committed = "";
  try {
    committed = execSync("git diff --name-only HEAD~5..HEAD", {
      cwd: REPO_ROOT, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], shell: process.platform === "win32" ? process.env.COMSPEC || "cmd.exe" : true, windowsHide: true,
    }).trim();
  } catch (err) { console.warn(`[task-completed] git diff HEAD~5 failed: ${err?.message}`); }

  const all = `${uncommitted}\n${committed}`.trim();
  if (all) {
    changedFiles = [...new Set(all.split(/\r?\n/).filter(Boolean))];
  }
} catch (err) { console.warn(`[task-completed] git diff failed: ${err?.message}`); }

if (changedFiles.length === 0) {
  console.error("[task-completed] No changed files detected — passing through");
  process.exit(0);
}

// ── Run done-criteria checks (language-aware) ────────────────
const failures = [];

// Load config once (reused by quality checks + no-abandon gate)
let quorumConfig = null;
let presets = [];
try {
  const configPath = resolve(REPO_ROOT, ".claude", "quorum", "config.json");
  if (existsSync(configPath)) {
    quorumConfig = JSON.parse(readFileSync(configPath, "utf8"));
    presets = quorumConfig.quality_rules?.presets ?? [];
  }
} catch (err) { console.warn(`[task-completed] config read error: ${err?.message}`); }

// Run quality checks via shared helper
const qcFailures = runQualityChecks({ config: quorumConfig, repoRoot: REPO_ROOT, changedFiles });
failures.push(...qcFailures);
if (qcFailures.length === 0 && presets.length === 0) {
  console.error("[task-completed] No quality_rules presets matched — skipping CQ checks");
}

// ── No-abandon gate: evidence must exist before task completion ──
// Check audit-status.json marker (written by bridge after every audit).
try {
  if (quorumConfig) {
    const auditStatusPath = resolve(REPO_ROOT, ".claude", "audit-status.json");
    let hasEvidence = false;

    // 1. Check SQLite marker (primary)
    if (existsSync(auditStatusPath)) {
      try {
        const status = JSON.parse(readFileSync(auditStatusPath, "utf8"));
        if (status.status === "approved" || status.status === "changes_requested" || status.status === "infra_failure") {
          hasEvidence = true;
        }
      } catch (err) { console.warn(`[task-completed] audit status parse error: ${err?.message}`); }
    }

    // 2. No file fallback — evidence is in SQLite only

    if (!hasEvidence) {
      failures.push("[NO-ABANDON] No audit evidence found. Submit evidence and run audit before completing task.");
    }
  }
} catch (err) { console.warn(`[task-completed] no-abandon gate error: ${err?.message}`); }

// ── Verdict ──────────────────────────────────────────────────
if (failures.length > 0) {
  const feedback = [
    `🚫 Task "${taskSubject}" cannot be completed — ${failures.length} done-criteria failure(s):`,
    "",
    ...failures,
    "",
    "Fix these issues before marking the task as complete.",
  ].join("\n");

  process.stderr.write(feedback);
  process.exit(2); // Exit 2 = feedback, task stays in-progress
}

// ── Emit task completion to EventStore ──
try {
  const bridge = await import("../../core/bridge.mjs");
  await bridge.init(REPO_ROOT);
  bridge.event.emitEvent("agent.complete", "claude-code", {
    name: teammateName || taskSubject,
    task: taskSubject,
  });
  bridge.close();
} catch (err) { console.warn(`[task-completed] bridge event emit failed: ${err?.message}`); }

console.error(`[task-completed] All checks passed for: "${taskSubject}"`);
process.exit(0);
