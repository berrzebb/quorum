/**
 * Shared repo root resolver — used by all adapter hook handlers.
 *
 * Deduplicates resolveRepoRoot() that was copy-pasted across
 * session-start.mjs, prompt-submit.mjs, session-stop.mjs, pre-compact.mjs.
 *
 * Resolution order:
 *   1. QUORUM_REPO_ROOT env var (cached from previous call)
 *   2. git rev-parse --show-toplevel (worktree-aware)
 *   3. Adapter layout fallback (3 levels up from adapter dir)
 *   4. process.cwd()
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";

/**
 * Resolve the repository root directory.
 *
 * @param {object} [opts]
 * @param {string} [opts.adapterDir] — __dirname of the calling adapter hook (for layout fallback)
 * @param {boolean} [opts.cache=true] — cache result in QUORUM_REPO_ROOT env var
 * @returns {string} Absolute path to repo root
 */
export function resolveRepoRoot(opts = {}) {
  const { adapterDir, cache = true } = opts;

  // 0. Cached via env var
  if (process.env.QUORUM_REPO_ROOT) return process.env.QUORUM_REPO_ROOT;

  // 1. git rev-parse (primary — worktree-aware)
  try {
    const r = spawnSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    });
    if (r.status === 0 && r.stdout) {
      const root = r.stdout.trim();
      if (cache) process.env.QUORUM_REPO_ROOT = root;
      return root;
    }
  } catch { /* git not available */ }

  // 2. Adapter layout fallback: adapter dir is typically inside the repo
  //    claude-code: adapters/claude-code/ → 3 levels up = repo root
  //    gemini:      adapters/gemini/hooks/scripts/ → 4 levels up = repo root
  if (adapterDir) {
    // Try 3 levels up first (standard adapter layout)
    for (const levels of [3, 4, 2]) {
      const parts = new Array(levels).fill("..");
      const candidate = resolve(adapterDir, ...parts);
      if (existsSync(resolve(candidate, ".git"))) {
        if (cache) process.env.QUORUM_REPO_ROOT = candidate;
        return candidate;
      }
    }
  }

  // 3. CLAUDE_PLUGIN_ROOT / GEMINI_EXTENSION_ROOT fallback
  const envRoot = process.env.QUORUM_ADAPTER_ROOT
    ?? process.env.CLAUDE_PLUGIN_ROOT
    ?? process.env.GEMINI_EXTENSION_ROOT;
  if (envRoot) {
    const candidate = resolve(envRoot, "..", "..", "..");
    if (existsSync(resolve(candidate, ".git"))) {
      if (cache) process.env.QUORUM_REPO_ROOT = candidate;
      return candidate;
    }
  }

  // 4. Last resort
  return process.cwd();
}
