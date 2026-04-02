/**
 * quorum plan — work breakdown planning with RTM status integration.
 *
 * Lists existing plans with completion status from RTM files.
 * Parser logic delegated to orchestrate/planning module (single source of truth).
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";

import { findTracks, parseWorkBreakdown } from '../../orchestrate/planning/index.js';
import { parseTableCells } from "../../core/markdown-table-parser.mjs";

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

/**
 * Convert discovered TrackInfo + parsed WorkItems into display Tracks.
 * This is the bridge between the planning module (parsing) and plan CLI (presentation).
 */
function discoverTracks(repoRoot: string): Track[] {
  const trackInfos = findTracks(repoRoot);

  return trackInfos.map(info => {
    const workItems = parseWorkBreakdown(info.path);
    const items: TaskItem[] = workItems.map(wi => ({
      id: wi.id,
      title: wi.title ?? "",
      status: "open" as TaskItem["status"],
      ...(wi.parentId ? { parentId: wi.parentId } : {}),
      ...(wi.isParent ? { isParent: true } : {}),
    }));
    return { name: info.name, path: info.path, items };
  });
}

function listPlans(repoRoot: string): void {
  const unique = discoverTracks(repoRoot);

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
  } catch (err) { console.warn(`[plan] git worktree list failed: ${(err as Error).message}`); }

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
  } catch (err) { console.warn(`[plan] scanForRtm failed for ${dir}: ${(err as Error).message}`); }
}

function parseRtmFile(path: string, status: Map<string, TaskItem["status"]>): void {
  const content = readFileSync(path, "utf8");
  let headerCols: string[] = [];

  for (const line of content.split(/\r?\n/)) {
    if (!line.startsWith("|") || line.includes("---")) continue;

    const cells = parseTableCells(line).filter(Boolean);
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
  if (cell === "verified" || cell === "done" || cell === "complete" || cell === "approved") return "verified";
  if (cell === "wip" || cell === "in-progress" || cell.startsWith("partial")) return "wip";
  if (cell === "blocked" || cell === "failed" || cell === "rejected") return "blocked";
  // "pending" is the RTM initial value — treat as open
  return "open";
}

function showPlan(repoRoot: string, trackName: string | undefined): void {
  if (!trackName) {
    console.log("  Usage: quorum plan show <track-name>\n");
    return;
  }

  const tracks = discoverTracks(repoRoot);
  const track = tracks.find((t) => t.name === trackName);
  if (!track) {
    console.log(`  Track '${trackName}' not found.\n`);
    return;
  }

  const content = readFileSync(track.path, "utf8");
  console.log(content);
}
