/**
 * Shared config resolver — finds and loads quorum config.json.
 *
 * Deduplicates config path resolution from session-start.mjs, prompt-submit.mjs,
 * pre-compact.mjs, session-stop.mjs, session-gate.mjs.
 *
 * Priority chain:
 *   1. REPO_ROOT/.claude/quorum/config.json (project-scoped, survives plugin updates)
 *   2. $QUORUM_ADAPTER_ROOT/config.json (env var — adapter-agnostic)
 *   3. $CLAUDE_PLUGIN_ROOT/config.json (Claude Code plugin dir)
 *   4. $GEMINI_EXTENSION_ROOT/config.json (Gemini CLI extension dir)
 *   5. adapterDir/config.json (direct fallback)
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Find config.json path without loading it.
 *
 * @param {object} opts
 * @param {string} opts.repoRoot — absolute path to repository root
 * @param {string} [opts.adapterDir] — __dirname of the calling adapter
 * @returns {string|null} Absolute path to config.json, or null if not found
 */
export function findConfigPath({ repoRoot, adapterDir }) {
  // 1. Project-scoped (persistent across plugin updates)
  if (repoRoot) {
    const projectConfig = resolve(repoRoot, ".claude", "quorum", "config.json");
    if (existsSync(projectConfig)) return projectConfig;
  }

  // 2-4. Env var chain
  const envRoots = [
    process.env.QUORUM_ADAPTER_ROOT,
    process.env.CLAUDE_PLUGIN_ROOT,
    process.env.GEMINI_EXTENSION_ROOT,
  ].filter(Boolean);

  for (const root of envRoots) {
    const p = resolve(root, "config.json");
    if (existsSync(p)) return p;
  }

  // 5. Adapter directory fallback
  if (adapterDir) {
    const local = resolve(adapterDir, "config.json");
    if (existsSync(local)) return local;
  }

  return null;
}

/**
 * Load config.json — returns parsed object or default config if not found.
 *
 * @param {object} opts
 * @param {string} opts.repoRoot — absolute path to repository root
 * @param {string} [opts.adapterDir] — __dirname of the calling adapter
 * @returns {{ cfg: object, configPath: string|null, configMissing: boolean }}
 */
export function loadConfig({ repoRoot, adapterDir }) {
  const DEFAULT_CONFIG = {
    plugin: { locale: "en", hooks_enabled: {} },
    consensus: {
      watch_file: "docs/feedback/claude.md",
      trigger_tag: "[REVIEW_NEEDED]",
      agree_tag: "[APPROVED]",
      pending_tag: "[CHANGES_REQUESTED]",
    },
  };

  const configPath = findConfigPath({ repoRoot, adapterDir });
  if (!configPath) {
    return { cfg: DEFAULT_CONFIG, configPath: null, configMissing: true };
  }

  try {
    const cfg = JSON.parse(readFileSync(configPath, "utf8"));
    return { cfg, configPath, configMissing: false };
  } catch {
    return { cfg: DEFAULT_CONFIG, configPath, configMissing: true };
  }
}

/**
 * Extract consensus tags from config with defaults.
 *
 * @param {object} cfg — parsed config.json
 * @returns {{ watchFile: string, triggerTag: string, agreeTag: string, pendingTag: string }}
 */
export function extractTags(cfg) {
  const c = cfg.consensus ?? {};
  return {
    watchFile: c.watch_file ?? "docs/feedback/claude.md",
    triggerTag: c.trigger_tag ?? "[GPT미검증]",
    agreeTag: c.agree_tag ?? "[합의완료]",
    pendingTag: c.pending_tag ?? "[계류]",
  };
}
