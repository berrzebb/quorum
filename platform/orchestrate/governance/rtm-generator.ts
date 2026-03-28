/**
 * RTM (Requirements Traceability Matrix) skeleton generation.
 *
 * Pure function — takes work items, returns markdown string.
 * No file I/O, no status updates, no lifecycle hooks.
 */

import type { WorkItem } from "../../../cli/commands/orchestrate/shared.js";

/**
 * Generate a skeletal RTM from work breakdown items.
 * Pre-implementation: all rows are "pending". Post-implementation: Scout
 * updates status via forward/backward scan with code_map + dependency_graph.
 *
 * This ensures every WB has a traceable verification checklist BEFORE
 * any agent starts implementing.
 */
export function generateSkeletalRTM(items: WorkItem[], trackName: string): string {
  const rows = items.map(item => {
    const files = item.targetFiles.length > 0 ? item.targetFiles.join(", ") : "TBD";
    const verify = item.verify ?? "not specified";
    // Sanitize done field — must be single-line for table row integrity
    const done = (item.done ?? "not specified").replace(/\n/g, " ").replace(/\s{2,}/g, " ").trim();
    return `| ${item.id} | ${item.title ?? item.id} | ${files} | ${verify} | ${done} | pending |`;
  });

  return `# RTM — ${trackName}

> Requirements Traceability Matrix (auto-generated from work breakdown)
> Status: pre-implementation. Run Scout after implementation to update.

## Forward Trace (Requirement → Code → Test)

| Req ID | Description | Target Files | Verify Command | Done Criteria | Status |
|--------|-------------|--------------|----------------|---------------|--------|
${rows.join("\n")}

## Backward Trace (Test → Requirement)

> Populated by Scout after implementation (code_map + dependency_graph scan).

| Test File | Covers Req | Import Chain | Status |
|-----------|------------|--------------|--------|
| _(run Scout to populate)_ | | | |

## Bidirectional Summary

- **Total requirements**: ${items.length}
- **Covered**: 0
- **Gaps**: ${items.length} (all pending — pre-implementation)
- **Orphan tests**: 0

## Gap Report

All ${items.length} requirements are pending implementation.
Priority order based on dependencies:
${items.filter(i => !i.dependsOn || i.dependsOn.length === 0).map(i => `- **${i.id}**: no dependencies (can start immediately)`).join("\n")}
${items.filter(i => i.dependsOn && i.dependsOn.length > 0).map(i => `- **${i.id}**: depends on ${i.dependsOn!.join(", ")}`).join("\n")}
`;
}
