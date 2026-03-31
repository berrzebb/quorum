/**
 * Harness Workspace Bridge — maps Harness _workspace/ to quorum's bus events.
 *
 * Harness uses a `_workspace/` directory convention for inter-agent data
 * passing. This bridge makes those artifacts observable via quorum's
 * EventStore, enabling governance tracking of agent handoffs.
 *
 * File naming convention:
 *   {phase}_{agent}_{artifact}.{ext}
 *   e.g., 01_analyst_requirements.md, 02_builder_implementation.ts
 */

import { existsSync, readdirSync, statSync } from "node:fs";
import { join, basename } from "node:path";

// ── Types ───────────────────────────────────────────────

export interface WorkspaceArtifact {
  /** File path relative to _workspace/. */
  relativePath: string;
  /** Absolute file path. */
  absolutePath: string;
  /** Parsed phase number (from filename convention). */
  phase: number | null;
  /** Parsed agent name (from filename convention). */
  agent: string | null;
  /** Parsed artifact name (from filename convention). */
  artifact: string | null;
  /** File size in bytes. */
  size: number;
  /** Last modified timestamp (ISO string). */
  modifiedAt: string;
}

export interface WorkspaceSummary {
  /** Path to _workspace/ directory. */
  workspaceDir: string;
  /** Whether the workspace directory exists. */
  exists: boolean;
  /** All discovered artifacts. */
  artifacts: WorkspaceArtifact[];
  /** Unique phases found. */
  phases: number[];
  /** Unique agents found. */
  agents: string[];
}

// ── Scanning ────────────────────────────────────────────

/** Parse the Harness file naming convention: {phase}_{agent}_{artifact}.{ext} */
function parseArtifactName(filename: string): { phase: number | null; agent: string | null; artifact: string | null } {
  const match = filename.match(/^(\d+)_([a-z][a-z0-9-]*)_(.+)$/i);
  if (match) {
    return {
      phase: parseInt(match[1]!, 10),
      agent: match[2]!,
      artifact: match[3]!.replace(/\.[^.]+$/, ""), // strip extension
    };
  }
  return { phase: null, agent: null, artifact: null };
}

/**
 * Scan a Harness _workspace/ directory and return a summary.
 */
export function scanWorkspace(projectRoot: string): WorkspaceSummary {
  const workspaceDir = join(projectRoot, "_workspace");

  if (!existsSync(workspaceDir)) {
    return { workspaceDir, exists: false, artifacts: [], phases: [], agents: [] };
  }

  const artifacts: WorkspaceArtifact[] = [];

  let entries: string[];
  try {
    entries = readdirSync(workspaceDir);
  } catch {
    return { workspaceDir, exists: true, artifacts: [], phases: [], agents: [] };
  }

  for (const entry of entries) {
    const fullPath = join(workspaceDir, entry);
    try {
      const stat = statSync(fullPath);
      if (!stat.isFile()) continue;

      const { phase, agent, artifact } = parseArtifactName(entry);
      artifacts.push({
        relativePath: entry,
        absolutePath: fullPath,
        phase,
        agent,
        artifact,
        size: stat.size,
        modifiedAt: stat.mtime.toISOString(),
      });
    } catch { continue; }
  }

  const phases = [...new Set(artifacts.map(a => a.phase).filter((p): p is number => p !== null))].sort();
  const agents = [...new Set(artifacts.map(a => a.agent).filter((a): a is string => a !== null))];

  return { workspaceDir, exists: true, artifacts, phases, agents };
}

/**
 * Build a bus event payload from a workspace artifact.
 * Suitable for emitting as a quorum "agent.handoff" event.
 */
export function buildHandoffEvent(artifact: WorkspaceArtifact): Record<string, unknown> {
  return {
    type: "agent.handoff",
    source: artifact.agent ?? "unknown",
    phase: artifact.phase,
    artifact: artifact.artifact ?? artifact.relativePath,
    path: artifact.absolutePath,
    size: artifact.size,
    timestamp: artifact.modifiedAt,
  };
}
