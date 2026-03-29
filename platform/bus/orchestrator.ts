/**
 * Orchestrator Mode Selection — auto-selects execution strategy for work items.
 *
 * Based on MCO (Multi-Claude Orchestration) 5-mode pattern:
 * - serial:   All items run one-by-one (high conflict density)
 * - parallel:  All items run simultaneously (zero conflicts)
 * - fan-out:  One upstream, multiple independent downstream consumers
 * - pipeline: Linear chain A → B → C (each depends on previous)
 * - hybrid:   Group-based execution from ParallelPlanner (groups sequential, items within group parallel)
 *
 * Selection uses conflict graph density + dependency topology.
 */

import { planParallel, type WorkItem, type PlanResult } from "./parallel.js";

export type OrchestratorMode = "serial" | "parallel" | "fan-out" | "pipeline" | "hybrid";

export interface ModeSelection {
  mode: OrchestratorMode;
  plan: PlanResult;
  reasons: string[];
  /** Recommended max concurrency (0 = unlimited for parallel). */
  maxConcurrency: number;
}

/**
 * Analyze work items and select the optimal orchestration mode.
 */
export function selectMode(items: WorkItem[]): ModeSelection {
  if (items.length === 0) {
    return {
      mode: "serial",
      plan: { groups: [], depth: 0, maxWidth: 0, unschedulable: [] },
      reasons: ["empty work set"],
      maxConcurrency: 1,
    };
  }

  if (items.length === 1) {
    const plan = planParallel(items);
    return {
      mode: "serial",
      plan,
      reasons: ["single work item"],
      maxConcurrency: 1,
    };
  }

  const plan = planParallel(items);

  // Detect unschedulable (circular dependency) — return serial with maxConcurrency 1
  if (plan.unschedulable.length > 0 && plan.groups.length === 0) {
    return {
      mode: "serial",
      plan,
      reasons: [`all ${plan.unschedulable.length} items have circular dependencies — serial fallback`],
      maxConcurrency: 1,
    };
  }
  const reasons: string[] = [];
  if (plan.unschedulable.length > 0) {
    reasons.push(`${plan.unschedulable.length} items have circular dependencies`);
  }

  // ── Mode detection ──

  // 1. Pure parallel: zero conflicts, zero dependencies → all items in one group
  if (plan.depth === 1 && plan.maxWidth === items.length) {
    reasons.push("zero file conflicts, zero dependencies");
    return { mode: "parallel", plan, reasons, maxConcurrency: items.length };
  }

  // 2. Pipeline: linear dependency chain (A→B→C), maxWidth=1 with explicit deps
  //    Must check before serial — pipeline is a strict subset of serial topology
  if (plan.maxWidth === 1 && isPipelineTopology(items)) {
    reasons.push("linear dependency chain detected");
    return { mode: "pipeline", plan, reasons, maxConcurrency: 1 };
  }

  // 3. Pure serial: every pair conflicts → depth equals item count
  if (plan.depth === items.length && plan.maxWidth === 1) {
    reasons.push("every item pair has file conflicts or dependencies");
    return { mode: "serial", plan, reasons, maxConcurrency: 1 };
  }

  // 4. Fan-out: one item has no dependencies, all others depend on it
  const fanOutRoot = detectFanOut(items);
  if (fanOutRoot) {
    reasons.push(`fan-out from ${fanOutRoot}`);
    return { mode: "fan-out", plan, reasons, maxConcurrency: items.length - 1 };
  }

  // 5. Hybrid: mixed conflicts → use group-based scheduling
  const conflictDensity = computeConflictDensity(items);
  reasons.push(`conflict density: ${(conflictDensity * 100).toFixed(0)}%`);
  reasons.push(`depth: ${plan.depth}, maxWidth: ${plan.maxWidth}`);
  return { mode: "hybrid", plan, reasons, maxConcurrency: plan.maxWidth };
}

// ── Helpers ──

/**
 * Conflict density: ratio of conflicting pairs to total possible pairs.
 * 0.0 = no conflicts, 1.0 = all items conflict with each other.
 */
function computeConflictDensity(items: WorkItem[]): number {
  if (items.length < 2) return 0;

  const totalPairs = (items.length * (items.length - 1)) / 2;
  let conflictingPairs = 0;

  // Count pairs sharing at least one file
  for (let i = 0; i < items.length; i++) {
    const filesI = new Set(items[i]!.targetFiles);
    for (let j = i + 1; j < items.length; j++) {
      const hasOverlap = items[j]!.targetFiles.some(f => filesI.has(f));
      if (hasOverlap) conflictingPairs++;
    }
  }

  return conflictingPairs / totalPairs;
}

/**
 * Check if items form a linear pipeline: A→B→C→D (each depends on exactly one previous).
 */
function isPipelineTopology(items: WorkItem[]): boolean {
  if (items.length < 2) return false;

  // Count items with 0 dependencies (must be exactly 1 = the pipeline head)
  const heads = items.filter(i => !i.dependsOn || i.dependsOn.length === 0);
  if (heads.length !== 1) return false;

  // Each non-head item must depend on exactly 1 item
  const nonHeads = items.filter(i => i.dependsOn && i.dependsOn.length > 0);
  if (!nonHeads.every(i => i.dependsOn!.length === 1)) return false;

  // Verify it forms a single chain (no branches)
  const itemIds = new Set(items.map(i => i.id));

  // Every dep target must be in item set, and each item can be depended on by at most 1 other
  const depCountMap = new Map<string, number>();
  for (const nh of nonHeads) {
    const dep = nh.dependsOn![0]!;
    if (!itemIds.has(dep)) return false;
    depCountMap.set(dep, (depCountMap.get(dep) ?? 0) + 1);
  }

  // Pipeline: each item is depended on by at most 1 successor
  return [...depCountMap.values()].every(c => c === 1);
}

/**
 * Detect fan-out topology: one root, all others depend only on root.
 */
function detectFanOut(items: WorkItem[]): string | null {
  if (items.length < 3) return null;

  const roots = items.filter(i => !i.dependsOn || i.dependsOn.length === 0);
  if (roots.length !== 1) return null;

  const rootId = roots[0]!.id;
  const consumers = items.filter(i => i.id !== rootId);

  // Every consumer depends on exactly the root
  const isFanOut = consumers.every(
    i => i.dependsOn?.length === 1 && i.dependsOn[0] === rootId,
  );

  return isFanOut ? rootId : null;
}
