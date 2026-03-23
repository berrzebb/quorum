/**
 * Parallel Planner — dependency-driven parallelization using file claims.
 *
 * Given a set of work items (each declaring target files), determines which
 * items can run in parallel without file conflicts. Uses greedy graph coloring:
 * items sharing any target file are "conflicting" and cannot share a group.
 *
 * Output: ExecutionGroup[] where items within each group can run in parallel,
 * and groups execute sequentially in order.
 */

import type { ClaimService, ClaimConflict } from "./claim.js";

export interface WorkItem {
  /** Unique identifier for this work item. */
  id: string;
  /** Files this work item intends to modify. */
  targetFiles: string[];
  /** Optional explicit dependency: must run after this item. */
  dependsOn?: string[];
  /** Estimated duration in ms (for scheduling hints). */
  estimatedMs?: number;
}

export interface ExecutionGroup {
  /** Execution order (0 = first group to run). */
  order: number;
  /** Work items that can safely run in parallel within this group. */
  items: WorkItem[];
  /** Files touched by this group (union of all items' targetFiles). */
  files: string[];
}

export interface PlanResult {
  groups: ExecutionGroup[];
  /** Total number of sequential steps needed. */
  depth: number;
  /** Maximum parallelism within any single group. */
  maxWidth: number;
  /** Items that cannot be scheduled (circular dependency). */
  unschedulable: string[];
}

/**
 * Plan parallel execution of work items based on file overlap + explicit dependencies.
 *
 * Algorithm:
 * 1. Build conflict graph: items sharing target files get an edge
 * 2. Add edges from explicit dependsOn relationships
 * 3. Topological layers via greedy coloring (respecting dependency order)
 */
export function planParallel(items: WorkItem[]): PlanResult {
  if (items.length === 0) {
    return { groups: [], depth: 0, maxWidth: 0, unschedulable: [] };
  }

  const itemMap = new Map(items.map(i => [i.id, i]));

  // Build adjacency: file conflicts
  const conflicts = new Map<string, Set<string>>();
  for (const item of items) {
    conflicts.set(item.id, new Set());
  }

  // File → items mapping
  const fileOwners = new Map<string, string[]>();
  for (const item of items) {
    for (const file of item.targetFiles) {
      const owners = fileOwners.get(file) ?? [];
      owners.push(item.id);
      fileOwners.set(file, owners);
    }
  }

  // Items sharing files conflict
  for (const [, owners] of fileOwners) {
    for (let i = 0; i < owners.length; i++) {
      for (let j = i + 1; j < owners.length; j++) {
        conflicts.get(owners[i]!)!.add(owners[j]!);
        conflicts.get(owners[j]!)!.add(owners[i]!);
      }
    }
  }

  // Build dependency graph (directed: dependsOn → must come before)
  const mustPrecede = new Map<string, Set<string>>(); // id → set of ids that must finish first
  for (const item of items) {
    mustPrecede.set(item.id, new Set());
  }
  for (const item of items) {
    if (!item.dependsOn) continue;
    for (const dep of item.dependsOn) {
      if (itemMap.has(dep)) {
        mustPrecede.get(item.id)!.add(dep);
      }
    }
  }

  // Topological sort with layers (Kahn's algorithm, grouped by ready-at-same-time)
  const scheduled = new Set<string>();
  const groups: ExecutionGroup[] = [];
  const unschedulable: string[] = [];
  let remaining = new Set(items.map(i => i.id));

  for (let round = 0; remaining.size > 0 && round < items.length; round++) {
    // Find items with all dependencies satisfied
    const ready: string[] = [];
    for (const id of remaining) {
      const deps = mustPrecede.get(id)!;
      const allMet = [...deps].every(d => scheduled.has(d));
      if (allMet) ready.push(id);
    }

    if (ready.length === 0) {
      // Circular dependency — remaining items are unschedulable
      unschedulable.push(...remaining);
      break;
    }

    // Greedy coloring within ready items: group non-conflicting ones
    const used = new Set<string>();     // items assigned in this round
    const groupItems: WorkItem[] = [];
    const groupFiles = new Set<string>();

    // Sort by most conflicts first (heuristic: schedule constrained items early)
    ready.sort((a, b) => (conflicts.get(b)?.size ?? 0) - (conflicts.get(a)?.size ?? 0));

    for (const id of ready) {
      // Can this item join the current group?
      const item = itemMap.get(id)!;
      const hasConflict = groupItems.some(gi => conflicts.get(gi.id)?.has(id));
      if (!hasConflict) {
        groupItems.push(item);
        for (const f of item.targetFiles) groupFiles.add(f);
        used.add(id);
      }
    }

    if (groupItems.length > 0) {
      groups.push({
        order: groups.length,
        items: groupItems,
        files: [...groupFiles],
      });
      for (const id of used) {
        scheduled.add(id);
        remaining.delete(id);
      }
    }

    // Items that were ready but conflicted with this group stay for next round
  }

  return {
    groups,
    depth: groups.length,
    maxWidth: Math.max(0, ...groups.map(g => g.items.length)),
    unschedulable,
  };
}

/**
 * Validate a plan against current claims. Returns conflicts for items
 * whose target files are already claimed by agents outside the plan.
 */
export function validateAgainstClaims(
  plan: PlanResult,
  claimService: ClaimService,
  planAgentId: string,
): Map<string, ClaimConflict[]> {
  const result = new Map<string, ClaimConflict[]>();
  for (const group of plan.groups) {
    for (const item of group.items) {
      const conflicts = claimService.checkConflicts(planAgentId, item.targetFiles);
      if (conflicts.length > 0) {
        result.set(item.id, conflicts);
      }
    }
  }
  return result;
}
