/**
 * Codex Plugin Broker Detection — detects codex-plugin-cc availability.
 *
 * codex-plugin-cc (openai/codex-plugin-cc) provides a persistent broker
 * process that multiplexes Codex sessions. This module detects
 * whether that broker is reachable.
 *
 * Detection strategy:
 * - Check for `codex-companion.mjs` via the codex plugin's known paths
 * - Verify the codex CLI is available (codex-plugin-cc requires it)
 *
 * Results are cached for the session lifetime to avoid repeated I/O.
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve, join } from "node:path";

// ── Cache ───────────────────────────────────────────────

let cachedAvailability: boolean | null = null;
let cachedCompanionPath: string | null = null;

/**
 * Reset cached detection results (for testing).
 */
export function resetBrokerCache(): void {
  cachedAvailability = null;
  cachedCompanionPath = null;
}

// ── Detection ───────────────────────────────────────────

/**
 * Locate the codex-companion.mjs script from codex-plugin-cc.
 *
 * Search order:
 * 1. CODEX_COMPANION_SCRIPT env var (explicit override)
 * 2. Claude Code plugin data directories (installed via marketplace)
 * 3. Global npm install path
 */
function findCompanionScript(): string | null {
  // 1. Explicit override
  if (process.env.CODEX_COMPANION_SCRIPT) {
    const p = process.env.CODEX_COMPANION_SCRIPT;
    if (existsSync(p)) return p;
  }

  // 2. Claude Code plugin directories
  const pluginDataDirs = [
    process.env.CLAUDE_PLUGIN_DATA,
    process.env.CLAUDE_PLUGIN_ROOT,
  ].filter(Boolean) as string[];

  for (const dir of pluginDataDirs) {
    // codex-plugin-cc installs as "codex" plugin under the marketplace
    const candidate = resolve(dir, "..", "codex", "scripts", "codex-companion.mjs");
    if (existsSync(candidate)) return candidate;
    // Also check sibling plugin directory
    const sibling = resolve(dir, "..", "..", "openai-codex", "codex", "scripts", "codex-companion.mjs");
    if (existsSync(sibling)) return sibling;
  }

  // 3. Check if codex-companion is accessible via npx or global install
  // Look in common global paths
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
  const globalPaths = [
    join(home, ".claude", "plugins", "openai-codex", "codex", "scripts", "codex-companion.mjs"),
    join(home, ".claude", "plugins", "codex", "scripts", "codex-companion.mjs"),
  ];
  for (const p of globalPaths) {
    if (existsSync(p)) return p;
  }

  return null;
}

/**
 * Check if the Codex CLI itself is available (required by codex-plugin-cc).
 */
function isCodexCliAvailable(): boolean {
  try {
    const bin = process.platform === "win32" ? "codex.cmd" : "codex";
    const result = spawnSync(bin, ["--version"], {
      encoding: "utf8",
      timeout: 5000,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return result.status === 0;
  } catch {
    return false;
  }
}

/**
 * Check whether codex-plugin-cc is available for use.
 *
 * Returns true if both:
 * 1. The codex-companion.mjs script can be located
 * 2. The codex CLI binary is accessible
 *
 * Results are cached for the session lifetime.
 */
export function isCodexPluginAvailable(): boolean {
  if (cachedAvailability !== null) return cachedAvailability;

  const companion = findCompanionScript();
  if (!companion) {
    cachedAvailability = false;
    return false;
  }

  if (!isCodexCliAvailable()) {
    cachedAvailability = false;
    return false;
  }

  cachedCompanionPath = companion;
  cachedAvailability = true;
  return true;
}

/**
 * Get the path to the codex-companion.mjs script.
 * Returns null if codex-plugin-cc is not available.
 * Call isCodexPluginAvailable() first to populate the cache.
 */
export function getCompanionScriptPath(): string | null {
  if (cachedAvailability === null) isCodexPluginAvailable();
  return cachedCompanionPath;
}
