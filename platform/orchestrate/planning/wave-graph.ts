/**
 * Wave graph builder — computes execution waves from work items.
 *
 * Uses phase hierarchy + dependsOn for topological ordering.
 * Phase parents define gate boundaries: Phase N must complete before Phase N+1 starts.
 * Within a phase, topological sort by dependsOn creates sub-waves.
 * Items in the same wave can run in parallel (up to concurrency limit).
 *
 * Pure function — no file I/O.
 */

import type { WorkItem, Wave } from './types.js';

/**
 * Compute execution waves from work items.
 * Uses phase hierarchy + dependsOn for topological ordering.
 */
export function computeWaves(items: WorkItem[]): Wave[] {
  const parents = items.filter(i => i.isParent);
  const children = items.filter(i => !i.isParent);
  const waves: Wave[] = [];
  let waveIdx = 0;

  if (parents.length === 0) {
    // No hierarchy — pure topological sort
    for (const group of topologicalWaves(children)) {
      waves.push({ index: waveIdx++, phaseId: null, items: group });
    }
    return waves;
  }

  // Group children by parent
  const childrenByParent = new Map<string, WorkItem[]>();
  const orphans: WorkItem[] = [];
  for (const c of children) {
    if (c.parentId) {
      const list = childrenByParent.get(c.parentId) ?? [];
      list.push(c);
      childrenByParent.set(c.parentId, list);
    } else {
      orphans.push(c);
    }
  }

  // Process phases in order — each phase is a gate boundary
  for (const parent of parents) {
    const kids = childrenByParent.get(parent.id) ?? [];
    if (kids.length === 0) continue;

    const phaseWaves = topologicalWaves(kids);
    for (const group of phaseWaves) {
      waves.push({ index: waveIdx++, phaseId: parent.id, items: group });
    }
  }

  // Orphans (no parent) go last
  if (orphans.length > 0) {
    waves.push({ index: waveIdx++, phaseId: null, items: orphans });
  }

  return waves;
}

/** Topological sort by dependsOn depth. Items at the same depth form a wave. */
function topologicalWaves(items: WorkItem[]): WorkItem[][] {
  const ids = new Set(items.map(i => i.id));
  const waves: WorkItem[][] = [];
  const placed = new Set<string>();

  while (placed.size < items.length) {
    const wave: WorkItem[] = [];
    for (const item of items) {
      if (placed.has(item.id)) continue;
      // Ready if all deps are placed or not in this group (external dep = already done)
      const ready = (item.dependsOn ?? []).every(dep => placed.has(dep) || !ids.has(dep));
      if (ready) wave.push(item);
    }
    if (wave.length === 0) {
      // Circular or unresolved deps — force remaining into one wave
      waves.push(items.filter(i => !placed.has(i.id)));
      break;
    }
    for (const item of wave) placed.add(item.id);
    waves.push(wave);
  }

  return waves;
}
