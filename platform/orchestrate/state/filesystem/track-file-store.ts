/**
 * Track file path resolution — pure path computation, no file I/O.
 *
 * Mirrors the exact path patterns from runner.ts:
 *   - trackDir    = dirname(track.path)           (parent of work-breakdown.md)
 *   - designDir   = resolve(trackDir, "design")
 *   - rtmPath     = resolve(trackDir, "rtm.md")
 *   - wbPath      = track.path                    (work-breakdown.md itself)
 *   - checkpointDir = resolve(repoRoot, ".claude", "quorum")
 *   - agentDir    = resolve(repoRoot, ".claude", "agents")
 */

import { resolve, dirname } from "node:path";

/** Directory containing the track's work-breakdown.md and sibling files. */
export function resolveTrackDir(wbPath: string): string {
  return dirname(wbPath);
}

/** Design document directory (mermaid diagrams, blueprints). */
export function resolveDesignDir(trackDir: string): string {
  return resolve(trackDir, "design");
}

/** RTM markdown path (sibling of work-breakdown.md). */
export function resolveRTMPath(trackDir: string): string {
  return resolve(trackDir, "rtm.md");
}

/** Work-breakdown file path — identity function, but explicit for contract clarity. */
export function resolveWBPath(trackDir: string, wbFilename = "work-breakdown.md"): string {
  return resolve(trackDir, wbFilename);
}

/** Wave checkpoint directory: `.claude/quorum/`. */
export function resolveCheckpointDir(projectRoot: string): string {
  return resolve(projectRoot, ".claude", "quorum");
}

/** Agent session directory: `.claude/agents/`. */
export function resolveAgentDir(projectRoot: string): string {
  return resolve(projectRoot, ".claude", "agents");
}
