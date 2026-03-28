/**
 * Wave session state — in-memory tracking of agent execution progress.
 *
 * Tracks which agents are running, completed, failed, and spawned
 * within a single wave execution cycle. No persistence, no I/O.
 */

import type { WorkItem } from "../planning/types.js";

/** An active agent session entry. */
export interface ActiveSession {
  item: WorkItem;
  sessionId: string;
  retries: number;
  outputFile?: string;
}

/** A failed item with its reason. */
export interface FailedItem {
  itemId: string;
  reason: string;
}

/** In-memory state for a single wave's execution cycle. */
export class WaveSessionState {
  private _active: ActiveSession[] = [];
  private _spawned = new Set<string>();
  private _completed = new Set<string>();
  private _failed: FailedItem[] = [];
  private _outputSizes = new Map<string, { size: number; at: number }>();

  addActive(session: ActiveSession): void {
    this._active.push(session);
    this._spawned.add(session.item.id);
  }

  removeActive(sessionId: string): ActiveSession | undefined {
    const idx = this._active.findIndex(s => s.sessionId === sessionId);
    if (idx < 0) return undefined;
    return this._active.splice(idx, 1)[0];
  }

  getActive(): readonly ActiveSession[] { return this._active; }
  activeCount(): number { return this._active.length; }

  markSpawned(itemId: string): void { this._spawned.add(itemId); }
  isSpawned(itemId: string): boolean { return this._spawned.has(itemId); }
  spawnedCount(): number { return this._spawned.size; }

  markCompleted(itemId: string): void { this._completed.add(itemId); }
  isCompleted(itemId: string): boolean { return this._completed.has(itemId); }
  getCompleted(): string[] { return [...this._completed]; }

  markFailed(itemId: string, reason: string): void {
    this._failed.push({ itemId, reason });
  }
  getFailed(): readonly FailedItem[] { return this._failed; }

  updateOutputSize(sessionId: string, size: number): void {
    const prev = this._outputSizes.get(sessionId);
    if (prev && prev.size === size) return;
    this._outputSizes.set(sessionId, { size, at: Date.now() });
  }

  getOutputSize(sessionId: string): { size: number; at: number } | undefined {
    return this._outputSizes.get(sessionId);
  }

  /** Check if a session has stalled (no new output for threshold ms). */
  isStalled(sessionId: string, currentSize: number, thresholdMs: number): boolean {
    const prev = this._outputSizes.get(sessionId);
    if (!prev) return false;
    return prev.size === currentSize && (Date.now() - prev.at) > thresholdMs;
  }
}
