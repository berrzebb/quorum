/**
 * Roster builder — constructs the wave agent roster (who does what).
 *
 * Pure function. Takes wave items + concurrency, returns slot assignments.
 * No spawning, no I/O, no provider calls.
 */

import type { WorkItem, Wave } from "../planning/types.js";

/** A single agent assignment in a wave roster. */
export interface RosterSlot {
  /** Agent identifier (e.g., "impl-WB-01") */
  agentId: string;
  /** Work breakdown item ID */
  wbId: string;
  /** Files this agent will touch */
  targetFiles: string[];
  /** IDs of items this one depends on */
  dependsOn: string[];
  /** Slot index within the roster (0-based) */
  slotIndex: number;
}

/**
 * Build the agent roster for a wave.
 *
 * Maps each wave item to a roster slot with an agent ID, target files,
 * dependencies, and a slot index. The slot index is capped at concurrency
 * to show which items share a concurrency bucket.
 *
 * @param wave     - Wave containing items to assign
 * @param concurrency - Max parallel agents (determines slot cycling)
 * @returns Ordered roster slots, one per item
 */
export function buildWaveRoster(wave: Wave, concurrency: number): RosterSlot[] {
  const cap = Math.max(1, concurrency);
  return wave.items.map((item, idx) => ({
    agentId: `impl-${item.id}`,
    wbId: item.id,
    targetFiles: item.targetFiles,
    dependsOn: item.dependsOn ?? [],
    slotIndex: idx % cap,
  }));
}

/**
 * Check whether an item's intra-wave dependencies are all resolved.
 *
 * An item can spawn only if every dep that lives in the same wave
 * has already been completed.
 *
 * @param item         - The candidate item
 * @param waveItemIds  - Set of all item IDs in this wave
 * @param completedIds - Set of globally completed item IDs
 */
export function canSpawnItem(
  item: WorkItem,
  waveItemIds: Set<string>,
  completedIds: Set<string>,
): boolean {
  for (const dep of item.dependsOn ?? []) {
    if (waveItemIds.has(dep) && !completedIds.has(dep)) return false;
  }
  return true;
}
