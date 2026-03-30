#!/usr/bin/env node
/* global process, Buffer */

/**
 * WorktreeRemove hook: clean up after agent worktree is removed.
 *
 * 1. Evidence preserved in SQLite (no file archival needed)
 * 2. Update handoff state — mark worktree branch as completed
 * 3. Clean up git worktree reference
 *
 * Non-blocking — failures are logged but do not prevent removal.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, basename, dirname } from "node:path";
import { execSync, execFileSync } from "node:child_process";
import { gitSync } from "../../core/cli-runner.mjs";

// ── Read stdin ───────────────────────────────────────────────
let input;
try {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) process.exit(0);
  input = JSON.parse(raw);
} catch (err) {
  console.warn(`[worktree-remove] stdin parse error: ${err?.message}`);
  process.exit(0);
}

const worktreePath = input.worktree_path || "";
if (!worktreePath) process.exit(0);

const worktreeName = basename(worktreePath);

// ── Resolve main repo root ───────────────────────────────────
let REPO_ROOT;
try {
  // WorktreeRemove fires from main session, so cwd is the main repo
  REPO_ROOT = execSync("git rev-parse --show-toplevel", { encoding: "utf8", windowsHide: true }).trim();
} catch (err) {
  console.warn(`[worktree-remove] git rev-parse failed: ${err?.message}`);
  REPO_ROOT = process.cwd();
}

// ── 1. Evidence preservation removed — evidence is in SQLite EventStore ──
try {
  // No file-based evidence to preserve. SQLite events persist across worktree lifecycle.
  console.error(`[worktree-remove] Evidence in SQLite — no file archival needed`);
} catch (e) {
  console.error(`[worktree-remove] Warning: ${e.message}`);
}

// ── 2. Read worktree metadata ────────────────────────────────
let meta = null;
try {
  const metaPath = resolve(worktreePath, ".claude", "worktree-meta.json");
  if (existsSync(metaPath)) {
    meta = JSON.parse(readFileSync(metaPath, "utf8"));
    console.error(`[worktree-remove] Worktree meta: branch=${meta.branch}, created=${meta.created_at}`);
  }
} catch (err) { console.warn(`[worktree-remove] metadata read failure: ${err?.message}`); }

// ── 3. Clean up git worktree ─────────────────────────────────
try {
  if (existsSync(worktreePath)) {
    gitSync(["worktree", "remove", "--force", worktreePath], {
      cwd: REPO_ROOT,
      stdio: ["pipe", "pipe", "pipe"],
      shell: process.platform === "win32" ? process.env.COMSPEC || "cmd.exe" : true, windowsHide: true,
    });
    console.error(`[worktree-remove] Removed worktree: ${worktreePath}`);
  }
} catch (e) {
  console.error(`[worktree-remove] git worktree remove warning: ${e.message}`);
}

// ── 4. Clean up branch (if worktree had no changes) ──────────
try {
  if (meta?.branch) {
    // Check if branch has any commits beyond the parent
    const log = execFileSync("git", ["log", "--oneline", `main..${meta.branch}`], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    }).trim();

    if (!log) {
      // No unique commits — safe to delete the branch
      gitSync(["branch", "-d", meta.branch], {
        cwd: REPO_ROOT,
        stdio: ["pipe", "pipe", "pipe"],
        shell: process.platform === "win32" ? process.env.COMSPEC || "cmd.exe" : true, windowsHide: true,
      });
      console.error(`[worktree-remove] Cleaned up empty branch: ${meta.branch}`);
    } else {
      console.error(`[worktree-remove] Branch ${meta.branch} has ${log.split("\n").length} commit(s) — preserved`);
    }
  }
} catch (err) { console.warn(`[worktree-remove] branch cleanup failure: ${err?.message}`); }

process.exit(0);
