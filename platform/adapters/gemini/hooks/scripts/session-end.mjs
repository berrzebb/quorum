#!/usr/bin/env node
/**
 * Gemini CLI Hook: SessionEnd
 *
 * Cleanup on session end — auto-commit artifacts, RTM update.
 * Mirrors adapters/claude-code/session-stop.mjs with shared modules.
 */
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { resolveRepoRoot } from "../../../shared/repo-resolver.mjs";
import { loadConfig } from "../../../shared/config-resolver.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ADAPTER_DIR = resolve(__dirname, "..");
const REPO_ROOT = resolveRepoRoot({ adapterDir: __dirname });
const { cfg } = loadConfig({ repoRoot: REPO_ROOT, adapterDir: ADAPTER_DIR });

function git(args, cwd) {
  try {
    const r = spawnSync("git", args, {
      cwd: cwd ?? REPO_ROOT, encoding: "utf8", stdio: "pipe", windowsHide: true,
    });
    return r.status === 0 ? (r.stdout || "").trim() : null;
  } catch {
    return null;
  }
}

// Stage session artifacts
const artifacts = [".claude/CLAUDE.md"];
for (const f of artifacts) {
  if (existsSync(resolve(REPO_ROOT, f))) {
    git(["add", f]);
  }
}

const staged = git(["diff", "--cached", "--name-only"]);
if (staged) {
  const diff = git(["diff", "--cached", "--stat"]) || "";
  git(["commit", "-m", `chore: auto-commit session artifacts\n\n${diff}\n\nCo-Authored-By: Gemini CLI <noreply@google.com>`, "--no-verify"]);
}

// Auto-update RTMs
try {
  const platformRoot = resolve(ADAPTER_DIR, "..", "..", "..");
  const rtmUpdater = resolve(platformRoot, "core", "rtm-updater.mjs");
  if (existsSync(rtmUpdater)) {
    const { updateAllRtms } = await import(rtmUpdater);
    updateAllRtms(REPO_ROOT);
  }
} catch { /* non-fatal */ }
