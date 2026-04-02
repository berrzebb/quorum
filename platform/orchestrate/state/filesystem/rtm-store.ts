/**
 * Filesystem-backed RTM store.
 *
 * Implements RTMPort — reads/writes/parses `rtm.md` markdown tables.
 * Mirrors the exact format from runner.ts updateRTM / generateSkeletalRTM.
 *
 * RTM path: `{trackDir}/rtm.md` (sibling of work-breakdown.md).
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { parseTableCells } from "../../../core/markdown-table-parser.mjs";
import type { RTMPort } from "../state-port.js";
import type { RTMEntry, RTMState, RTMStatus } from "../state-types.js";

export class FilesystemRTMStore implements RTMPort {
  private rtmPath(trackDir: string): string {
    return resolve(trackDir, "rtm.md");
  }

  exists(trackDir: string): boolean {
    return existsSync(this.rtmPath(trackDir));
  }

  load(trackDir: string): RTMState | null {
    const p = this.rtmPath(trackDir);
    if (!existsSync(p)) return null;
    try {
      const content = readFileSync(p, "utf8");
      return parseRTMMarkdown(content);
    } catch (err) {
      console.error(`[rtm-store] failed to load RTM from ${trackDir}: ${(err as Error).message}`);
      return null;
    }
  }

  save(trackDir: string, state: RTMState): void {
    const p = this.rtmPath(trackDir);
    if (!existsSync(trackDir)) mkdirSync(trackDir, { recursive: true });
    writeFileSync(p, serializeRTMMarkdown(state), "utf8");
  }

  updateStatus(trackDir: string, reqIds: string[], status: RTMStatus): void {
    const p = this.rtmPath(trackDir);
    if (!existsSync(p)) return;
    try {
      let content = readFileSync(p, "utf8");
      for (const id of reqIds) {
        const escapedId = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const pattern = new RegExp(
          `(\\|\\s*${escapedId}\\s*\\|[^\\n]*\\|)\\s*(?:pending|implemented|failed)\\s*\\|`,
        );
        content = content.replace(pattern, `$1 ${status} |`);
      }
      writeFileSync(p, content, "utf8");
    } catch (err) {
      console.error(`[rtm-store] updateStatus failed for ${trackDir}: ${(err as Error).message}`);
    }
  }
}

// ── RTM Markdown Parser ──────────────────────

function parseRTMMarkdown(content: string): RTMState {
  const lines = content.split("\n");

  // Extract track name from heading: "# RTM — {trackName}"
  const headingMatch = lines[0]?.match(/^#\s+RTM\s+—\s+(.+)$/);
  const trackName = headingMatch?.[1]?.trim() ?? "unknown";

  const forwardTrace = parseTableSection(lines, "Forward Trace");
  const backwardTrace = parseBackwardTrace(lines);
  const summary = parseSummary(lines);

  return {
    trackName,
    forwardTrace,
    backwardTrace,
    summary: {
      totalRequirements: summary.total,
      covered: summary.covered,
      gaps: summary.gaps,
      orphanTests: summary.orphans,
    },
  };
}

function parseTableSection(lines: string[], sectionName: string): RTMEntry[] {
  const entries: RTMEntry[] = [];
  let inSection = false;
  let headerSkipped = false;

  for (const line of lines) {
    if (line.includes(sectionName)) { inSection = true; continue; }
    if (inSection && line.startsWith("## ") && !line.includes(sectionName)) break;
    if (!inSection) continue;

    // Skip header row and separator
    if (line.startsWith("| Req ID") || line.startsWith("| ---") || line.startsWith("|---")) {
      headerSkipped = true;
      continue;
    }
    if (!headerSkipped || !line.startsWith("|")) continue;

    const cols = parseTableCells(line).filter(Boolean);
    if (cols.length < 6) continue;
    // Skip placeholder rows
    if (cols[0]!.startsWith("_")) continue;

    entries.push({
      reqId: cols[0]!,
      description: cols[1]!,
      targetFiles: cols[2]!,
      verifyCommand: cols[3]!,
      doneCriteria: cols[4]!,
      status: cols[5] as RTMStatus,
    });
  }
  return entries;
}

function parseBackwardTrace(lines: string[]): RTMState["backwardTrace"] {
  const entries: RTMState["backwardTrace"] = [];
  let inSection = false;
  let headerSkipped = false;

  for (const line of lines) {
    if (line.includes("Backward Trace")) { inSection = true; continue; }
    if (inSection && line.startsWith("## ") && !line.includes("Backward Trace")) break;
    if (!inSection) continue;

    if (line.startsWith("| Test File") || line.startsWith("| ---") || line.startsWith("|---")) {
      headerSkipped = true;
      continue;
    }
    if (!headerSkipped || !line.startsWith("|")) continue;

    const cols = parseTableCells(line).filter(Boolean);
    if (cols.length < 4 || cols[0]!.startsWith("_")) continue;

    entries.push({
      testFile: cols[0]!,
      coversReq: cols[1]!,
      importChain: cols[2]!,
      status: cols[3]!,
    });
  }
  return entries;
}

function parseSummary(lines: string[]): { total: number; covered: number; gaps: number; orphans: number } {
  const result = { total: 0, covered: 0, gaps: 0, orphans: 0 };
  for (const line of lines) {
    const totalMatch = line.match(/Total requirements\*\*:\s*(\d+)/);
    if (totalMatch) result.total = parseInt(totalMatch[1]!, 10);
    const coveredMatch = line.match(/Covered\*\*:\s*(\d+)/);
    if (coveredMatch) result.covered = parseInt(coveredMatch[1]!, 10);
    const gapsMatch = line.match(/Gaps\*\*:\s*(\d+)/);
    if (gapsMatch) result.gaps = parseInt(gapsMatch[1]!, 10);
    const orphanMatch = line.match(/Orphan tests\*\*:\s*(\d+)/);
    if (orphanMatch) result.orphans = parseInt(orphanMatch[1]!, 10);
  }
  return result;
}

// ── RTM Markdown Serializer ──────────────────

function serializeRTMMarkdown(state: RTMState): string {
  const fwdRows = state.forwardTrace.map(e =>
    `| ${e.reqId} | ${e.description} | ${e.targetFiles} | ${e.verifyCommand} | ${e.doneCriteria} | ${e.status} |`,
  );

  const bwdRows = state.backwardTrace.length > 0
    ? state.backwardTrace.map(e =>
      `| ${e.testFile} | ${e.coversReq} | ${e.importChain} | ${e.status} |`,
    )
    : ["| _(run Scout to populate)_ | | | |"];

  const s = state.summary;
  return `# RTM — ${state.trackName}

> Requirements Traceability Matrix (auto-generated from work breakdown)
> Status: pre-implementation. Run Scout after implementation to update.

## Forward Trace (Requirement → Code → Test)

| Req ID | Description | Target Files | Verify Command | Done Criteria | Status |
|--------|-------------|--------------|----------------|---------------|--------|
${fwdRows.join("\n")}

## Backward Trace (Test → Requirement)

> Populated by Scout after implementation (code_map + dependency_graph scan).

| Test File | Covers Req | Import Chain | Status |
|-----------|------------|--------------|--------|
${bwdRows.join("\n")}

## Bidirectional Summary

- **Total requirements**: ${s.totalRequirements}
- **Covered**: ${s.covered}
- **Gaps**: ${s.gaps}
- **Orphan tests**: ${s.orphanTests}
`;
}
