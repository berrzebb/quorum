/**
 * Config Change Detector — file watching with debounce and self-change detection.
 *
 * Uses Node.js fs.watch() (no chokidar dependency).
 * Stability threshold: 1000ms. Deletion grace: 1700ms.
 *
 * @module core/config/change-detector
 */

import { watch, existsSync, type FSWatcher } from "node:fs";
import type { ConfigTier } from "./types.js";
import { CONFIG_TIERS } from "./types.js";
import { resolveTierPath, invalidateTierCache } from "./settings.js";

// ── Types ───────────────────────────────────────────

/** Event emitted when config files change. */
export interface ConfigChangeEvent {
  tier: ConfigTier;
  filePath: string;
  timestamp: number;
}

/** Callback for config change events. */
export type ConfigChangeCallback = (event: ConfigChangeEvent) => void;

// ── Constants ───────────────────────────────────────

/** Debounce period — wait for no more changes before triggering. */
const STABILITY_THRESHOLD_MS = 1000;

/** Grace period for file deletion (editor save pattern). */
const DELETION_GRACE_MS = 1700;

// ── Change Detector ─────────────────────────────────

/**
 * Watches config files across all tiers for changes.
 *
 * Features:
 * - 1000ms stability debounce (rapid edits consolidated)
 * - 1700ms deletion grace (editor save-as-delete-then-create pattern)
 * - Self-change detection (internal writes ignored)
 */
export class ConfigChangeDetector {
  private watchers = new Map<string, FSWatcher>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private deletionTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private callbacks: ConfigChangeCallback[] = [];
  private pathToTier = new Map<string, ConfigTier>();
  private _lastInternalWriteMs = 0;

  /**
   * Start watching config files for changes.
   * @param repoRoot Repository root for resolving tier paths.
   */
  start(repoRoot?: string): void {
    this.stop(); // Clean up any existing watchers

    for (const tier of CONFIG_TIERS) {
      if (tier === "defaults") continue; // Hardcoded, no file

      const filePath = resolveTierPath(tier, repoRoot);
      if (!filePath) continue;

      this.pathToTier.set(filePath, tier);
      this.watchFile(filePath, tier);
    }
  }

  /** Stop watching all files. */
  stop(): void {
    for (const watcher of this.watchers.values()) {
      try { watcher.close(); } catch { /* ignore */ }
    }
    this.watchers.clear();

    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();

    for (const timer of this.deletionTimers.values()) clearTimeout(timer);
    this.deletionTimers.clear();
  }

  /** Register a change callback. */
  onChange(cb: ConfigChangeCallback): void {
    this.callbacks.push(cb);
  }

  /** Mark a timestamp as an internal write (to be ignored by the detector). */
  markInternalWrite(): void {
    this._lastInternalWriteMs = Date.now();
  }

  /** Check if a change event is from an internal write (within 500ms). */
  private isInternalWrite(): boolean {
    return Date.now() - this._lastInternalWriteMs < 500;
  }

  // ── Internal ────────────────────────────────────

  private watchFile(filePath: string, tier: ConfigTier): void {
    try {
      // Watch the directory containing the file (more reliable on some platforms)
      const watcher = watch(filePath, { persistent: false }, (eventType) => {
        this.handleChange(filePath, tier, eventType);
      });

      watcher.on("error", () => {
        // File might not exist yet — that's OK
      });

      this.watchers.set(filePath, watcher);
    } catch {
      // File or directory doesn't exist — skip silently
    }
  }

  private handleChange(filePath: string, tier: ConfigTier, eventType: string): void {
    // Ignore self-changes
    if (this.isInternalWrite()) return;

    // Handle deletion
    if (eventType === "rename" && !existsSync(filePath)) {
      this.handleDeletion(filePath, tier);
      return;
    }

    // Cancel any pending deletion grace
    const delTimer = this.deletionTimers.get(filePath);
    if (delTimer) {
      clearTimeout(delTimer);
      this.deletionTimers.delete(filePath);
    }

    // Reset stability timer (debounce)
    const existing = this.timers.get(filePath);
    if (existing) clearTimeout(existing);

    this.timers.set(
      filePath,
      setTimeout(() => {
        this.timers.delete(filePath);
        this.emitChange(filePath, tier);
      }, STABILITY_THRESHOLD_MS),
    );
  }

  private handleDeletion(filePath: string, tier: ConfigTier): void {
    // Wait for deletion grace period (editor might recreate the file)
    const timer = setTimeout(() => {
      this.deletionTimers.delete(filePath);
      if (!existsSync(filePath)) {
        // File really deleted — emit change
        this.emitChange(filePath, tier);
      }
    }, DELETION_GRACE_MS);

    this.deletionTimers.set(filePath, timer);
  }

  private emitChange(filePath: string, tier: ConfigTier): void {
    // Invalidate the tier cache
    invalidateTierCache(tier);

    const event: ConfigChangeEvent = {
      tier,
      filePath,
      timestamp: Date.now(),
    };

    for (const cb of this.callbacks) {
      try { cb(event); } catch { /* callbacks must not break detector */ }
    }
  }
}
