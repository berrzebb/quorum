/**
 * Config Source Tracker — tracks which tier each setting came from.
 *
 * Resolves settings from highest tier to lowest:
 *   policy → local → project → user → defaults
 *
 * @module core/config/source-tracker
 */

import type { ConfigTier, QuorumConfig } from "./types.js";
import { CONFIG_TIERS } from "./types.js";
import { getTierSnapshot, loadConfig } from "./settings.js";

// ── Types ───────────────────────────────────────────

/** Result of getConfigWithSources. */
export interface ConfigWithSources {
  /** The effective (merged) config. */
  effective: QuorumConfig;
  /** Map of dot-notation key path → source tier. */
  sources: Map<string, ConfigTier>;
}

// ── Key Path Utilities ──────────────────────────────

/**
 * Get a nested value from an object using a dot-notation path.
 * Returns undefined if any part of the path doesn't exist.
 */
function getNestedValue(obj: unknown, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/**
 * Collect all leaf key paths from an object (dot-notation).
 */
function collectKeyPaths(obj: unknown, prefix = ""): string[] {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return prefix ? [prefix] : [];

  const paths: string[] = [];
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      paths.push(...collectKeyPaths(value, fullKey));
    } else {
      paths.push(fullKey);
    }
  }
  return paths;
}

// ── Source Resolution ────────────────────────────────

/**
 * Determine which tier a specific setting key came from.
 *
 * Scans from highest priority (policy) to lowest (defaults).
 * Returns the first tier where the key exists.
 */
export function resolveSource(keyPath: string): ConfigTier {
  // Scan from highest to lowest priority
  const reversedTiers = [...CONFIG_TIERS].reverse(); // policy, local, project, user, defaults

  for (const tier of reversedTiers) {
    const snapshot = getTierSnapshot(tier);
    const value = getNestedValue(snapshot, keyPath);
    if (value !== undefined) return tier;
  }

  return "defaults";
}

// ── Main API ────────────────────────────────────────

/**
 * Get the effective config with source tracking for every setting.
 *
 * Returns the merged config + a Map from key path to source tier.
 * Useful for `/quorum:status config` display: "(set in: project)".
 */
export function getConfigWithSources(repoRoot?: string): ConfigWithSources {
  const effective = loadConfig(repoRoot);
  const sources = new Map<string, ConfigTier>();

  // Collect all key paths from the effective config
  const keyPaths = collectKeyPaths(effective);

  // Resolve source for each key
  for (const path of keyPaths) {
    sources.set(path, resolveSource(path));
  }

  return { effective, sources };
}

/**
 * Get a human-readable display string for a setting's source.
 * E.g., "(set in: project)" or "(set in: managed policy)".
 */
export function getSourceDisplay(keyPath: string): string {
  const tier = resolveSource(keyPath);
  const DISPLAY: Record<ConfigTier, string> = {
    defaults: "defaults",
    user: "user settings",
    project: "project",
    local: "local override",
    policy: "managed policy",
  };
  return `(set in: ${DISPLAY[tier]})`;
}
