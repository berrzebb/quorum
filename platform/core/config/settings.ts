/**
 * 5-Tier Settings Engine — hierarchical config loading and merging.
 *
 * Tiers (lowest to highest priority):
 *   defaults → user (~/.claude/quorum/) → project (.claude/quorum/)
 *   → local (.local.json) → policy (/etc/quorum/)
 *
 * Higher tiers override lower tiers. Arrays are concat + dedup.
 * Fully compatible with existing context.mjs cfg export (NFR-20).
 *
 * @module core/config/settings
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { homedir, platform } from "node:os";
import type { ConfigTier, QuorumConfig } from "./types.js";
import { DEFAULT_CONFIG, CONFIG_TIERS } from "./types.js";

// ── Path Resolution ─────────────────────────────────

/** Resolve the config file path for a given tier. */
export function resolveTierPath(tier: ConfigTier, repoRoot?: string): string {
  const root = repoRoot ?? process.cwd();

  switch (tier) {
    case "defaults":
      return ""; // Hardcoded, no file
    case "user": {
      const home = homedir();
      const os = platform();
      if (os === "darwin") return join(home, "Library", "Application Support", "quorum", "settings.json");
      if (os === "win32") return join(process.env.APPDATA ?? join(home, "AppData", "Roaming"), "quorum", "settings.json");
      return join(home, ".config", "quorum", "settings.json");
    }
    case "project":
      return resolve(root, ".claude", "quorum", "config.json");
    case "local":
      return resolve(root, ".claude", "quorum", "config.local.json");
    case "policy": {
      const os = platform();
      if (os === "win32") return join(process.env.PROGRAMDATA ?? "C:\\ProgramData", "quorum", "managed-settings.json");
      return "/etc/quorum/managed-settings.json";
    }
  }
}

// ── File Reading ────────────────────────────────────

/** Safely read and parse a JSON config file. Returns empty object if missing/invalid. */
export function readConfigFile(filePath: string): Partial<QuorumConfig> {
  if (!filePath || !existsSync(filePath)) return {};
  try {
    return JSON.parse(readFileSync(filePath, "utf8")) as Partial<QuorumConfig>;
  } catch {
    return {};
  }
}

// ── Deep Merge ──────────────────────────────────────

/**
 * Deep merge multiple config objects. Later objects override earlier ones.
 * Arrays are concatenated and deduplicated.
 */
export function mergeConfigs(...configs: Partial<QuorumConfig>[]): QuorumConfig {
  const result: Record<string, unknown> = {};

  for (const config of configs) {
    for (const [key, value] of Object.entries(config)) {
      if (value === undefined) continue;

      const existing = result[key];

      if (Array.isArray(existing) && Array.isArray(value)) {
        // Array concat + dedup
        const merged = [...existing, ...value];
        result[key] = [...new Set(merged.map(v =>
          typeof v === "object" ? JSON.stringify(v) : v,
        ))].map(v => {
          try { return typeof v === "string" && v.startsWith("{") ? JSON.parse(v) : v; }
          catch { return v; }
        });
      } else if (
        existing && typeof existing === "object" && !Array.isArray(existing) &&
        value && typeof value === "object" && !Array.isArray(value)
      ) {
        // Deep merge objects
        result[key] = mergeConfigs(
          existing as Partial<QuorumConfig>,
          value as Partial<QuorumConfig>,
        );
      } else {
        // Scalar override
        result[key] = value;
      }
    }
  }

  return result as QuorumConfig;
}

// ── Tier Snapshots ──────────────────────────────────

/** Raw per-tier config snapshots (for source tracking). */
let _tierSnapshots = new Map<ConfigTier, Partial<QuorumConfig>>();

/** Get the raw snapshot for a tier (for source tracking). */
export function getTierSnapshot(tier: ConfigTier): Partial<QuorumConfig> {
  return _tierSnapshots.get(tier) ?? {};
}

// ── Cache ───────────────────────────────────────────

let _cachedConfig: QuorumConfig | null = null;

// ── Main API ────────────────────────────────────────

/**
 * Load the full config by merging all 5 tiers.
 *
 * Returns a deep clone — caller mutations don't affect the cache.
 * Thread-safe: synchronous execution, no race conditions.
 */
export function loadConfig(repoRoot?: string): QuorumConfig {
  if (_cachedConfig) return structuredClone(_cachedConfig);

  const snapshots = new Map<ConfigTier, Partial<QuorumConfig>>();

  // Load each tier
  for (const tier of CONFIG_TIERS) {
    if (tier === "defaults") {
      snapshots.set(tier, structuredClone(DEFAULT_CONFIG));
      continue;
    }
    const path = resolveTierPath(tier, repoRoot);
    snapshots.set(tier, readConfigFile(path));
  }

  _tierSnapshots = snapshots;

  // Merge in priority order (defaults first, policy last = highest priority)
  const configs = CONFIG_TIERS.map(t => snapshots.get(t) ?? {});
  _cachedConfig = mergeConfigs(...configs);

  return structuredClone(_cachedConfig);
}

/** Reset the config cache. Next loadConfig() will re-read all files. */
export function resetConfigCache(): void {
  _cachedConfig = null;
  _tierSnapshots.clear();
}

/** Invalidate a specific tier's cache. */
export function invalidateTierCache(tier: ConfigTier): void {
  _cachedConfig = null; // Force full re-merge on next load
  _tierSnapshots.delete(tier);
}
