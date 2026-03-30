/**
 * Track catalog — discovery and resolution of orchestration tracks.
 *
 * Scans both docs/ and plans/ directories for work-breakdown.md files.
 * Extracted from cli/commands/orchestrate/shared.ts.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve, basename } from "node:path";

import type { TrackInfo } from "./types.js";

// ── Track discovery ──────────────────────────

/**
 * Discover tracks from docs/ and plans/ directories.
 * Both directories are scanned; duplicates (by name) are deduplicated.
 */
export function findTracks(repoRoot: string): TrackInfo[] {
  const tracks: TrackInfo[] = [];
  const searchDirs = [resolve(repoRoot, "docs"), resolve(repoRoot, "plans")];

  for (const dir of searchDirs) {
    if (!existsSync(dir)) continue;
    scanDir(dir, tracks);
  }

  const seen = new Set<string>();
  return tracks.filter(t => {
    if (seen.has(t.name)) return false;
    seen.add(t.name);
    return true;
  });
}

function scanDir(dir: string, tracks: TrackInfo[]): void {
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = resolve(dir, entry.name);
      if (entry.isDirectory()) {
        scanDir(fullPath, tracks);
      } else if (entry.name.includes("work-breakdown") && entry.name.endsWith(".md")) {
        const content = readFileSync(fullPath, "utf8");
        const bracketItems = content.match(/^###?\s+\[/gm) ?? [];
        const idItems = content.match(/^#{2,3}\s+[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-\d+/gm) ?? [];
        tracks.push({
          name: basename(resolve(fullPath, "..")),
          path: fullPath,
          items: Math.max(bracketItems.length, idItems.length),
        });
      }
    }
  } catch (err) { console.warn(`[track-catalog] directory scan failed for ${dir}: ${(err as Error).message}`); }
}

// ── Track resolution (name, index, or auto) ──

/**
 * Resolve a track by name, numeric index (1-based), or auto-select if only one exists.
 * Returns null if not found.
 */
export function resolveTrack(input: string | undefined, repoRoot: string): TrackInfo | null {
  const tracks = findTracks(repoRoot);
  if (tracks.length === 0) return null;

  // No input: auto-select if only one track
  if (!input) {
    return tracks.length === 1 ? tracks[0]! : null;
  }

  // Numeric index (1-based)
  const idx = parseInt(input, 10);
  if (!isNaN(idx) && idx >= 1 && idx <= tracks.length) {
    return tracks[idx - 1]!;
  }

  // Exact name match
  const exact = tracks.find(t => t.name === input);
  if (exact) return exact;

  // Prefix match (case-insensitive)
  const prefix = tracks.filter(t => t.name.toLowerCase().startsWith(input.toLowerCase()));
  if (prefix.length === 1) return prefix[0]!;

  return null;
}

/**
 * Format a short track reference for next-step suggestions.
 * Uses index if available, falls back to name.
 */
export function trackRef(trackName: string, repoRoot: string): string {
  const tracks = findTracks(repoRoot);
  if (tracks.length === 1) return "";  // no arg needed
  const idx = tracks.findIndex(t => t.name === trackName);
  return idx >= 0 ? String(idx + 1) : trackName;
}
