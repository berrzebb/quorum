/**
 * Drop-in Directory — managed settings from /etc/quorum/managed-settings.d/
 *
 * Loads *.json files in alphabetical order and merges them into policy tier.
 * Higher-numbered files override lower-numbered ones.
 *
 * @module core/config/managed-settings
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { platform } from "node:os";
import type { QuorumConfig } from "./types.js";
import { mergeConfigs } from "./settings.js";

// ── Drop-in Path ────────────────────────────────────

/** Resolve the drop-in directory path for the current OS. */
export function dropInDirectory(): string {
  const os = platform();
  if (os === "win32") {
    return join(process.env.PROGRAMDATA ?? "C:\\ProgramData", "quorum", "managed-settings.d");
  }
  return "/etc/quorum/managed-settings.d";
}

// ── Loader ──────────────────────────────────────────

/**
 * Load and merge all *.json files from the drop-in directory.
 *
 * - Files are sorted alphabetically (00-security.json before 10-quality.json)
 * - Later files override earlier ones
 * - Invalid JSON files are skipped with a warning
 * - Missing directory returns empty object
 */
export function loadDropInSettings(dirPath?: string): Partial<QuorumConfig> {
  const dir = dirPath ?? dropInDirectory();

  if (!existsSync(dir)) return {};

  let entries: string[];
  try {
    entries = readdirSync(dir).filter(f => f.endsWith(".json")).sort();
  } catch {
    return {};
  }

  if (entries.length === 0) return {};

  const configs: Partial<QuorumConfig>[] = [];

  for (const entry of entries) {
    const filePath = join(dir, entry);
    try {
      const content = readFileSync(filePath, "utf8");
      const parsed = JSON.parse(content) as Partial<QuorumConfig>;
      configs.push(parsed);
    } catch {
      // Skip invalid files — warn in production
      console.warn(`[managed-settings] Skipping invalid file: ${filePath}`);
    }
  }

  if (configs.length === 0) return {};
  if (configs.length === 1) return configs[0]!;

  return mergeConfigs(...configs);
}
