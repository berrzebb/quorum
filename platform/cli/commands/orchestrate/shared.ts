/** @module Compatibility shell — real implementation in orchestrate/planning/ */

import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const DIST = resolve(__dirname, "..", "..", "..", "..");

export type Bridge = Record<string, Function>;
export type WBSize = "XS" | "S" | "M";

export interface WorkItem {
  id: string;
  title?: string;
  targetFiles: string[];
  dependsOn?: string[];
  size?: WBSize;
  action?: string;
  contextBudget?: { read: string[]; skip: string[] };
  verify?: string;
  constraints?: string;
  done?: string;
  parentId?: string;
  isParent?: boolean;
  integrationTarget?: string;
}

export interface TrackInfo { name: string; path: string; items: number; }

export async function loadBridge(repoRoot: string): Promise<Bridge | null> {
  try {
    const toURL = (p: string) => pathToFileURL(p).href;
    const quorumRoot = resolve(DIST, "..");
    const bridge = await import(toURL(resolve(quorumRoot, "core", "bridge.mjs")));
    await bridge.init(repoRoot);
    return bridge;
  } catch { return null; }
}

export { findTracks, resolveTrack, trackRef } from '../../../orchestrate/planning/track-catalog.js';
export { parseWorkBreakdown } from '../../../orchestrate/planning/work-breakdown-parser.js';
export type { PlanReviewResult } from '../../../orchestrate/planning/types.js';
export { reviewPlan } from '../../../orchestrate/planning/plan-review.js';
export type { Wave } from '../../../orchestrate/planning/types.js';
export { computeWaves } from '../../../orchestrate/planning/wave-graph.js';
export { verifyDesignDiagrams } from '../../../orchestrate/planning/design-gates.js';
