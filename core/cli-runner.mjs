#!/usr/bin/env node
/**
 * Facade — main implementation at platform/core/cli-runner.mjs
 *
 * All exports are re-exported unchanged. No import paths in consumers need updating.
 */

export {
  resolveBinary,
  spawnResolved,
  spawnResolvedAsync,
  execResolved,
  gitSync,
} from "../platform/core/cli-runner.mjs";
