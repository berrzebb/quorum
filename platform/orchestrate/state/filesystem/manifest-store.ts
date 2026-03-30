/**
 * Filesystem-backed wave manifest store.
 *
 * Implements ManifestPort — reads/writes wave manifests via SQLite KV
 * (bridge.setState / bridge.getState with key `wave:manifest:{track}:{index}`).
 *
 * Mirrors the exact I/O from runner.ts recordWaveManifest / readPreviousManifests.
 */

import type { ManifestPort } from "../state-port.js";
import type { WaveManifestEntry } from "../state-types.js";

/**
 * Bridge subset — only the KV methods needed for manifest storage.
 * Avoids importing the full Bridge type (which is Record<string, Function>).
 */
export interface ManifestBridge {
  setState(key: string, value: unknown): void;
  getState(key: string): unknown;
}

export class FilesystemManifestStore implements ManifestPort {
  constructor(private bridge: ManifestBridge | null) {}

  load(trackName: string, waveIndex: number): WaveManifestEntry | null {
    if (!this.bridge?.getState) return null;
    try {
      const key = `wave:manifest:${trackName}:${waveIndex}`;
      const data = this.bridge.getState(key);
      return (data as WaveManifestEntry) ?? null;
    } catch (err) {
      console.error(`[manifest-store] failed to load manifest ${trackName}:${waveIndex}: ${(err as Error).message}`);
      return null;
    }
  }

  save(manifest: WaveManifestEntry): void {
    if (!this.bridge?.setState) return;
    try {
      const key = `wave:manifest:${manifest.trackName}:${manifest.waveIndex}`;
      this.bridge.setState(key, manifest);
    } catch (err) {
      console.warn(`[manifest-store] failed to save manifest: ${(err as Error).message}`);
    }
  }

  loadPrevious(trackName: string, beforeWaveIndex: number): WaveManifestEntry[] {
    if (!this.bridge?.getState) return [];
    const manifests: WaveManifestEntry[] = [];
    for (let i = 0; i < beforeWaveIndex; i++) {
      try {
        const key = `wave:manifest:${trackName}:${i}`;
        const m = this.bridge.getState(key);
        if (m) manifests.push(m as WaveManifestEntry);
      } catch (err) {
        console.warn(`[manifest-store] failed to load manifest ${trackName}:${i}: ${(err as Error).message}`);
      }
    }
    return manifests;
  }
}
