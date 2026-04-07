/**
 * Git snapshot + wave manifest recording.
 *
 * Captures pre-wave snapshot refs and records per-wave manifests
 * to SQLite MessageBus for dependency context injection.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import type { WaveManifest } from "./dependency-context.js";
import type { Bridge } from "../planning/types.js";

interface WorkItemLike {
  id: string;
}

/**
 * Capture a snapshot reference point before a wave starts.
 * Uses `git stash create` to create a temp ref without affecting working tree.
 */
export function captureSnapshot(repoRoot: string): string {
  try {
    const ref = execFileSync("git", ["stash", "create"], {
      cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    }).trim();
    return ref || "HEAD";
  } catch (err) { console.warn(`[snapshot] git stash create failed, using HEAD: ${(err as Error).message}`); return "HEAD"; }
}

/**
 * Record a wave manifest to SQLite MessageBus.
 * Captures changed files and their exports for dependency context injection.
 */
export function recordWaveManifest(
  repoRoot: string, bridge: Bridge | null, trackName: string, waveIndex: number,
  completedItems: WorkItemLike[], snapshotRef: string,
): void {
  if (!bridge?.setState) return;

  try {
    const stat = execFileSync("git", ["diff", "--name-only", snapshotRef], {
      cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true, maxBuffer: 10 * 1024 * 1024,
    }).trim();
    const changedFiles = stat ? stat.split("\n").filter(Boolean) : [];

    const fileExports: Record<string, string[]> = {};
    for (const file of changedFiles.slice(0, 20)) {
      try {
        const content = readFileSync(resolve(repoRoot, file), "utf8");
        const exports = content.split("\n")
          .filter(line => /^export\s/.test(line))
          .slice(0, 15);
        if (exports.length > 0) fileExports[file] = exports;
      } catch (err) { console.warn(`[snapshot] could not read exports from ${file}: ${(err as Error).message}`); }
    }

    bridge.query.setState(`wave:manifest:${trackName}:${waveIndex}`, {
      trackName, waveIndex,
      completedItems: completedItems.map(i => i.id),
      changedFiles, fileExports, recordedAt: Date.now(),
    });
  } catch (err) { console.warn(`[snapshot] recordWaveManifest failed: ${(err as Error).message}`); }
}

/**
 * Read previous wave manifests from SQLite MessageBus.
 * Used to build dependency context for current wave's agents.
 */
export function readPreviousManifests(
  bridge: Bridge | null, trackName: string, currentWaveIndex: number,
): WaveManifest[] {
  if (!bridge?.query?.getState) return [];
  const manifests: WaveManifest[] = [];
  for (let i = 0; i < currentWaveIndex; i++) {
    try {
      const m = bridge.query.getState(`wave:manifest:${trackName}:${i}`);
      if (m) manifests.push(m as WaveManifest);
    } catch (err) { console.warn(`[snapshot] readPreviousManifests failed for wave ${i}: ${(err as Error).message}`); }
  }
  return manifests;
}
