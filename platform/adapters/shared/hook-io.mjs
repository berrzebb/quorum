/**
 * Shared hook I/O helpers — eliminates boilerplate across all adapter hook scripts.
 *
 * Three patterns extracted:
 * 1. readStdinJson() — stdin read + JSON parse (14 scripts)
 * 2. withBridge() — bridge init/hookRunner/fire/close ceremony (11 scripts)
 * 3. createHookContext() — dirname/ADAPTER_DIR/REPO_ROOT/config preamble (11 scripts)
 * 4. createDebugLogger() — timestamped append log (3 scripts)
 *
 * @module adapters/shared/hook-io
 */

import { appendFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveRepoRoot } from "./repo-resolver.mjs";
import { loadConfig, extractTags } from "./config-resolver.mjs";

/**
 * Read stdin as JSON. Handles empty input and parse errors.
 *
 * @param {{ exitOnEmpty?: boolean, fallback?: object|null }} [opts]
 * @returns {Promise<object>}
 */
export async function readStdinJson({ exitOnEmpty = true, fallback = null } = {}) {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8").trim();

  if (!raw) {
    if (exitOnEmpty) process.exit(0);
    return fallback ?? {};
  }

  try {
    return JSON.parse(raw);
  } catch (err) {
    console.warn(`[hook-io] stdin JSON parse error: ${err?.message}`);
    if (exitOnEmpty) process.exit(0);
    return fallback ?? {};
  }
}

/**
 * Initialize bridge + HookRunner, execute callback, close. Fail-open.
 *
 * @param {string} repoRoot
 * @param {object} [hooksCfg] — cfg.hooks from config.json
 * @param {(bridge: object) => Promise<T>} fn — callback receiving initialized bridge
 * @returns {Promise<T|null>}
 * @template T
 */
export async function withBridge(repoRoot, hooksCfg, fn) {
  try {
    const bridge = await import("../../core/bridge.mjs");
    if (await bridge.init(repoRoot)) {
      await bridge.hooks.initHookRunner(repoRoot, hooksCfg);
      const result = await fn(bridge);
      bridge.close();
      return result;
    }
  } catch (err) { console.warn(`[hook-io] bridge init/run failed: ${err?.message}`); }
  return null;
}

/**
 * Create hook context from import.meta.url — replaces 5-line preamble.
 *
 * @param {string} importMetaUrl — pass import.meta.url
 * @param {number} [adapterLevelsUp=1] — how many dirs up from script to adapter root
 * @returns {{ __dirname: string, ADAPTER_DIR: string, REPO_ROOT: string, cfg: object, configMissing: boolean, consensus: object, tags: object }}
 */
export function createHookContext(importMetaUrl, adapterLevelsUp = 1) {
  const __dir = dirname(fileURLToPath(importMetaUrl));
  const ADAPTER_DIR = resolve(__dir, ...Array(adapterLevelsUp).fill(".."));
  const REPO_ROOT = resolveRepoRoot({ adapterDir: __dir });
  const { cfg, configPath, configMissing } = loadConfig({ repoRoot: REPO_ROOT, adapterDir: ADAPTER_DIR });
  const consensus = cfg?.consensus ?? {};
  const tags = configMissing ? {} : extractTags(cfg);
  return { __dirname: __dir, ADAPTER_DIR, REPO_ROOT, cfg, configMissing, consensus, tags };
}

/**
 * Create a timestamped debug logger.
 *
 * @param {string} adapterDir
 * @param {string} [filename="debug.log"]
 * @returns {(msg: string) => void}
 */
export function createDebugLogger(adapterDir, filename = "debug.log") {
  const logPath = resolve(adapterDir, filename);
  return function log(msg) {
    const ts = new Date().toISOString().replace("T", " ").slice(0, 19);
    try { appendFileSync(logPath, `[${ts}] ${msg}\n`); } catch (err) { console.warn(`[hook-io] debug log write failed: ${err?.message}`); }
  };
}
