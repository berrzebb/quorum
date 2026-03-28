/**
 * Filesystem-backed checkpoint store.
 *
 * Implements CheckpointPort — reads/writes `.claude/quorum/wave-state-{track}.json`.
 * Mirrors the exact I/O from runner.ts saveWaveState/loadWaveState.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import type { CheckpointPort } from "../state-port.js";
import type { WaveCheckpoint } from "../state-types.js";

export class FilesystemCheckpointStore implements CheckpointPort {
  constructor(private baseDir: string) {}

  load(trackName: string): WaveCheckpoint | null {
    const p = resolve(this.baseDir, `wave-state-${trackName}.json`);
    if (!existsSync(p)) return null;
    try {
      const data = JSON.parse(readFileSync(p, "utf8")) as WaveCheckpoint;
      if (data.trackName !== trackName) return null;
      return data;
    } catch {
      return null;
    }
  }

  save(checkpoint: WaveCheckpoint): void {
    if (!existsSync(this.baseDir)) mkdirSync(this.baseDir, { recursive: true });
    checkpoint.updatedAt = new Date().toISOString();
    const p = resolve(this.baseDir, `wave-state-${checkpoint.trackName}.json`);
    writeFileSync(p, JSON.stringify(checkpoint, null, 2), "utf8");
  }
}
