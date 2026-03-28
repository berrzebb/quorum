#!/usr/bin/env node
/**
 * Facade — main implementation at platform/core/enforcement.mjs
 *
 * All exports are re-exported unchanged. No import paths in consumers need updating.
 */

export {
  countTrackPendings,
  blockDownstreamTasks,
  parseResidualRisk,
  appendTechDebt,
  checkFalsePositiveRate,
  checkExplanation,
} from "../platform/core/enforcement.mjs";
