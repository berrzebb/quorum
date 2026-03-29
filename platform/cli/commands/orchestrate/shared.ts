/** @module Compatibility shell — real implementation in orchestrate/planning/ */

import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Bridge } from '../../../orchestrate/planning/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
/** At runtime: dist/platform/cli/commands/orchestrate/ → up 3 → dist/platform/ */
export const DIST = resolve(__dirname, "..", "..", "..");

export type { Bridge, WBSize, WorkItem, TrackInfo } from '../../../orchestrate/planning/types.js';

export async function loadBridge(repoRoot: string): Promise<Bridge | null> {
  try {
    const toURL = (p: string) => pathToFileURL(p).href;
    const quorumRoot = resolve(DIST, "..", "..");
    const bridge = await import(toURL(resolve(quorumRoot, "platform", "core", "bridge.mjs")));
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
