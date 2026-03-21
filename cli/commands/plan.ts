/**
 * quorum plan — work breakdown planning with RTM status integration.
 *
 * Lists existing plans with completion status from RTM files.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve, basename } from "node:path";

interface TaskItem {
  id: string;
  title: string;
  status: "verified" | "wip" | "open" | "blocked" | "unknown";
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
    const verified = track.items.filter((i) => i.status === "verified").length;
    const wip = track.items.filter((i) => i.status === "wip").length;
    const open = track.items.length - verified - wip;
    totalItems += track.items.length;
    totalVerified += verified;
    totalWip += wip;

    const pct = track.items.length > 0 ? Math.round((verified / track.items.length) * 100) : 0;
    const barWidth = 15;
    const filled = Math.round((pct / 100) * barWidth);
    const bar = `\x1b[32m${"█".repeat(filled)}\x1b[0m\x1b[2m${"░".repeat(barWidth - filled)}\x1b[0m`;

    console.log(`  \x1b[1m${track.name}\x1b[0m ${bar} ${pct}% \x1b[2m(${verified}/${track.items.length} verified, ${wip} wip)\x1b[0m`);

    for (const item of track.items) {
      const icon = statusIcon(item.status);
      console.log(`    ${icon} ${item.id} ${item.title}`);
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
    const { execFileSync } = require("node:child_process") as typeof import("node:child_process");
    const wtOutput = execFileSync("git", ["worktree", "list", "--porcelain"], {
      cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
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

        for (const line of content.split(/\r?\n/)) {
          const bracketMatch = line.match(/^###?\s+\[([^\]]+)\]\s*(.*)/);
          if (bracketMatch) {
            items.push({ id: bracketMatch[1]!, title: bracketMatch[2]!.trim(), status: "open" });
            continue;
          }
          const idMatch = line.match(/^##\s+([A-Z]{2,}-\d+[A-Za-z]?)\s+(.*)/);
          if (idMatch) {
            items.push({ id: idMatch[1]!, title: idMatch[2]!.trim(), status: "open" });
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
