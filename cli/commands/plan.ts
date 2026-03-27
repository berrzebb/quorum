/**
 * quorum plan — work breakdown planning with RTM status integration.
 *
 * Lists existing plans with completion status from RTM files.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve, basename } from "node:path";
import { execFileSync } from "node:child_process";

interface TaskItem {
  id: string;
  title: string;
  status: "verified" | "wip" | "open" | "blocked" | "unknown";
  /** Parent feature ID (null for top-level parents) */
  parentId?: string;
  /** Whether this is a parent (feature) item */
  isParent?: boolean;
}

interface Track {
  name: string;
  path: string;
  items: TaskItem[];
}

export async function run(args: string[]): Promise<void> {
  const repoRoot = process.cwd();
  const subcommand = args[0] ?? "list";

  console.log("\n\x1b[36mquorum plan\x1b[0m\n");

  switch (subcommand) {
    case "list":
      listPlans(repoRoot);
      break;
    case "show":
      showPlan(repoRoot, args[1]);
      break;
    default:
      console.log(`  Unknown subcommand: ${subcommand}`);
      console.log(`  Usage: quorum plan [list|show <track>]\n`);
  }
}

function listPlans(repoRoot: string): void {
  const searchDirs = [resolve(repoRoot, "docs"), resolve(repoRoot, "plans")];
  const tracks: Track[] = [];

  for (const dir of searchDirs) {
    if (!existsSync(dir)) continue;
    scanForBreakdowns(dir, tracks);
  }

  // Deduplicate by name
  const seen = new Set<string>();
  const unique = tracks.filter((t) => {
    if (seen.has(t.name)) return false;
    seen.add(t.name);
    return true;
  });

  if (unique.length === 0) {
    console.log("  No work breakdowns found.");
    console.log("  Create plans in docs/ or plans/ directories.\n");
    return;
  }

  // Load RTM status
  const rtmStatus = loadRtmStatus(repoRoot);

  // Apply RTM status to items
  for (const track of unique) {
    for (const item of track.items) {
      const rtmStat = rtmStatus.get(item.id);
      if (rtmStat) item.status = rtmStat;
    }
  }

  // Display
  let totalItems = 0;
  let totalVerified = 0;
  let totalWip = 0;

  for (const track of unique) {
    // Count only children (or all items if flat) for progress
    const countable = track.items.filter((i) => !i.isParent);
    const verified = countable.filter((i) => i.status === "verified").length;
    const wip = countable.filter((i) => i.status === "wip").length;
    totalItems += countable.length;
    totalVerified += verified;
    totalWip += wip;

    const pct = countable.length > 0 ? Math.round((verified / countable.length) * 100) : 0;
    const barWidth = 15;
    const filled = Math.round((pct / 100) * barWidth);
    const bar = `\x1b[32m${"█".repeat(filled)}\x1b[0m\x1b[2m${"░".repeat(barWidth - filled)}\x1b[0m`;

    console.log(`  \x1b[1m${track.name}\x1b[0m ${bar} ${pct}% \x1b[2m(${verified}/${countable.length} verified, ${wip} wip)\x1b[0m`);

    const hasHierarchy = track.items.some((i) => i.isParent);

    if (hasHierarchy) {
      // Group children by parent
      const parents = track.items.filter((i) => i.isParent);
      const childrenByParent = new Map<string, TaskItem[]>();
      const orphans: TaskItem[] = [];
      for (const item of track.items) {
        if (item.isParent) continue;
        if (item.parentId) {
          const list = childrenByParent.get(item.parentId) ?? [];
          list.push(item);
          childrenByParent.set(item.parentId, list);
        } else {
          orphans.push(item);
        }
      }

      for (const parent of parents) {
        const kids = childrenByParent.get(parent.id) ?? [];
        const kidsVerified = kids.filter((k) => k.status === "verified").length;
        console.log(`    \x1b[1m${parent.id}: ${parent.title}\x1b[0m [${kidsVerified}/${kids.length}]`);
        for (const child of kids) {
          const icon = statusIcon(child.status);
          console.log(`      ${icon} ${child.id} ${child.title}`);
        }
      }

      // Show orphan items (children without a parent) at top level
      for (const item of orphans) {
        const icon = statusIcon(item.status);
        console.log(`    ${icon} ${item.id} ${item.title}`);
      }
    } else {
      // Flat display (backwards compatible)
      for (const item of track.items) {
        const icon = statusIcon(item.status);
        console.log(`    ${icon} ${item.id} ${item.title}`);
      }
    }
    console.log();
  }

  // Summary
  const totalPct = totalItems > 0 ? Math.round((totalVerified / totalItems) * 100) : 0;
  console.log(`  \x1b[1mTotal:\x1b[0m ${totalVerified}/${totalItems} verified (${totalPct}%), ${totalWip} wip, ${totalItems - totalVerified - totalWip} open\n`);
}

function statusIcon(status: TaskItem["status"]): string {
  switch (status) {
    case "verified": return "\x1b[32m✓\x1b[0m";
    case "wip": return "\x1b[33m◐\x1b[0m";
    case "blocked": return "\x1b[31m✗\x1b[0m";
    case "open": return "\x1b[2m○\x1b[0m";
    default: return "\x1b[2m?\x1b[0m";
  }
}

// ── RTM status loader ─────────────────────────

function loadRtmStatus(repoRoot: string): Map<string, TaskItem["status"]> {
  const status = new Map<string, TaskItem["status"]>();

  // Main repo
  const searchDirs = [resolve(repoRoot, "docs"), resolve(repoRoot, "plans")];
  for (const dir of searchDirs) {
    if (!existsSync(dir)) continue;
    scanForRtm(dir, status);
  }

  // Worktrees — scan for RTMs that may be newer than main
  try {
    const wtOutput = execFileSync("git", ["worktree", "list", "--porcelain"], {
      cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true,
    });

    let wtPath = "";
    for (const line of wtOutput.split("\n")) {
      if (line.startsWith("worktree ")) {
        wtPath = line.slice(9).trim();
      } else if (line.startsWith("branch ") && wtPath && wtPath !== repoRoot) {
        for (const sub of ["docs", "plans"]) {
          const wtDir = resolve(wtPath, sub);
          if (existsSync(wtDir)) scanForRtm(wtDir, status);
        }
        wtPath = "";
      }
    }
  } catch { /* git worktree not available */ }

  return status;
}

function scanForRtm(dir: string, status: Map<string, TaskItem["status"]>): void {
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = resolve(dir, entry.name);
      if (entry.isDirectory()) {
        scanForRtm(fullPath, status);
      } else if (entry.name.startsWith("rtm") && entry.name.endsWith(".md")) {
        parseRtmFile(fullPath, status);
      }
    }
  } catch { /* skip */ }
}

function parseRtmFile(path: string, status: Map<string, TaskItem["status"]>): void {
  const content = readFileSync(path, "utf8");
  let headerCols: string[] = [];

  for (const line of content.split(/\r?\n/)) {
    if (!line.startsWith("|") || line.includes("---")) continue;

    const cells = line.split("|").map((c) => c.trim()).filter(Boolean);
    if (cells.length < 2) continue;

    // Detect header row (contains "Req ID" or "Status")
    if (cells.some((c) => /req.?id|status|track/i.test(c))) {
      headerCols = cells.map((c) => c.toLowerCase());
      continue;
    }

    const reqId = cells[0]!;
    if (!/^[A-Z]{2,}-\d+/.test(reqId)) continue;

    // Find status column (last column, or column named "status")
    const statusIdx = headerCols.indexOf("status");
    const lastCell = (statusIdx >= 0 ? cells[statusIdx] : cells[cells.length - 1])?.toLowerCase() ?? "";

    // Find WB column (maps FR-1 → EN-1) for work-breakdown ID mapping
    const wbIdx = headerCols.findIndex((c) => c === "wb" || c === "work breakdown" || c === "task");
    const wbId = wbIdx >= 0 ? cells[wbIdx] : null;

    // Collect all IDs to map: both the req ID and the WB ID
    const ids = [reqId];
    if (wbId && /^[A-Z]{2,}-\d+/.test(wbId)) ids.push(wbId);

    const resolvedStatus = resolveStatus(lastCell);

    for (const id of ids) {
      const existing = status.get(id);
      if (resolvedStatus === "verified") {
        if (!existing || existing === "open" || existing === "unknown") {
          status.set(id, "verified");
        }
      } else if (resolvedStatus === "wip") {
        // wip overrides verified if any row is wip
        if (existing !== "blocked") {
          status.set(id, "wip");
        }
      } else if (resolvedStatus === "blocked") {
        status.set(id, "blocked");
      } else if (!existing) {
        status.set(id, "open");
      }
    }
  }
}

function resolveStatus(cell: string): TaskItem["status"] {
  if (cell === "verified" || cell === "done" || cell === "complete") return "verified";
  if (cell === "wip" || cell === "in-progress" || cell.startsWith("partial")) return "wip";
  if (cell === "blocked") return "blocked";
  return "open";
}

// ── Work breakdown scanner ────────────────────
// Mirrors orchestrate/shared.ts parseWorkBreakdown() logic for hierarchy detection.
// Supports: Phase/Step parents, multi-segment IDs (DAW-P2-01), bracket format ([ID]).

function scanForBreakdowns(dir: string, tracks: Track[]): void {
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = resolve(dir, entry.name);
      if (entry.isDirectory()) {
        scanForBreakdowns(fullPath, tracks);
      } else if (entry.name.includes("work-breakdown") && entry.name.endsWith(".md")) {
        const content = readFileSync(fullPath, "utf8");
        const items: TaskItem[] = [];

        // ID pattern: WEB-1, DAW-P2-01, FEAT-3A, PROJECT-TRACK-42
        const ID_RE = /[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-\d+[A-Za-z]?/;

        // Detect Phase/Step parents (takes precedence over ID-based parents)
        const hasPhaseParents = /^##\s+(?:Phase|Step|단계)\s*\d+[A-Za-z]?[:\s]/m.test(content);

        // ID-based parents: h2=parent, h3=child (no Phase labels present)
        const hasIdParents = !hasPhaseParents
          && new RegExp(`^##\\s+(?:\\[)?${ID_RE.source}\\]?[:\\s]`, "m").test(content)
          && new RegExp(`^###\\s+(?:\\[)?${ID_RE.source}\\]?[:\\s]`, "m").test(content);

        const hasParents = hasPhaseParents || hasIdParents;

        // Build entries from two-pass regex (same as shared.ts)
        type Entry = { id: string; title: string; pos: number; isParent: boolean };
        const entries2: Entry[] = [];

        if (hasParents) {
          // Pass 1: Phase/Step parents — "## Phase 0: Prerequisites"
          const parentRe = /^#{2,3}\s+((?:Phase|Step|단계)\s*\d+[A-Za-z]?)\s*:\s*(.*)/gm;
          let m: RegExpExecArray | null;
          while ((m = parentRe.exec(content)) !== null) {
            entries2.push({ id: m[1]!.replace(/\s+/g, "-"), title: m[2]!.trim(), pos: m.index, isParent: true });
          }

          // Pass 2: ID children — "## DAW-P2-01: Title" or "### [WEB-1] Title"
          const childRe = new RegExp(`^#{2,3}\\s+(?:\\[)?(${ID_RE.source})\\]?\\s*[:\\s]\\s*(.*)`, "gm");
          while ((m = childRe.exec(content)) !== null) {
            entries2.push({ id: m[1]!, title: m[2]!.trim(), pos: m.index, isParent: false });
          }

          entries2.sort((a, b) => a.pos - b.pos);
        } else {
          // Flat: all h2/h3 with IDs are children
          const flatRe = new RegExp(`^#{2,3}\\s+(?:\\[)?(${ID_RE.source})\\]?\\s*[:\\s]\\s*(.*)`, "gm");
          let m: RegExpExecArray | null;
          while ((m = flatRe.exec(content)) !== null) {
            entries2.push({ id: m[1]!, title: m[2]!.trim(), pos: m.index, isParent: false });
          }
        }

        // Convert entries to TaskItems with parent tracking
        let currentParentId: string | undefined;
        for (const e of entries2) {
          const cleanTitle = e.title.replace(/\s*\((?:Size:)?\s*(?:XS|S|M)\)\s*$/, "").trim();
          if (e.isParent) {
            currentParentId = e.id;
            items.push({ id: e.id, title: cleanTitle, status: "open", isParent: true });
          } else {
            items.push({
              id: e.id, title: cleanTitle, status: "open",
              ...(hasParents && currentParentId ? { parentId: currentParentId } : {}),
            });
          }
        }

        tracks.push({ name: basename(resolve(fullPath, "..")), path: fullPath, items });
      }
    }
  } catch { /* skip */ }
}

function showPlan(repoRoot: string, trackName: string | undefined): void {
  if (!trackName) {
    console.log("  Usage: quorum plan show <track-name>\n");
    return;
  }

  const tracks: Track[] = [];
  const searchDirs = [resolve(repoRoot, "docs"), resolve(repoRoot, "plans")];
  for (const dir of searchDirs) {
    if (!existsSync(dir)) continue;
    scanForBreakdowns(dir, tracks);
  }

  const track = tracks.find((t) => t.name === trackName);
  if (!track) {
    console.log(`  Track '${trackName}' not found.\n`);
    return;
  }

  const content = readFileSync(track.path, "utf8");
  console.log(content);
}
