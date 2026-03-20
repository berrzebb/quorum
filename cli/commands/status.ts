/**
 * quorum status — show current audit gate status, evidence items,
 * active worktrees, and agent processes.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve, basename } from "node:path";
import { execFileSync } from "node:child_process";

export async function run(_args: string[]): Promise<void> {
  const repoRoot = process.cwd();

  console.log("\n\x1b[36mquorum status\x1b[0m\n");

  // ── Gates ───────────────────────────────────
  const lockPath = resolve(repoRoot, ".claude", "audit.lock");
  const auditActive = existsSync(lockPath);
  console.log(`  Audit gate:  ${auditActive ? "\x1b[33m● AUDITING\x1b[0m" : "\x1b[32m● OPEN\x1b[0m"}`);
  if (auditActive) {
    try {
      const lock = JSON.parse(readFileSync(lockPath, "utf8"));
      console.log(`               PID: ${lock.pid ?? "?"}, started: ${lock.startedAt ?? "?"}`);
    } catch { /* skip */ }
  }

  const markerPath = resolve(repoRoot, ".session-state", "retro-marker.json");
  const retroPending = existsSync(markerPath);
  console.log(`  Retro gate:  ${retroPending ? "\x1b[31m● BLOCKED (Bash/Agent locked)\x1b[0m" : "\x1b[32m● OPEN\x1b[0m"}`);
  if (retroPending) {
    try {
      const marker = JSON.parse(readFileSync(markerPath, "utf8"));
      console.log(`               session: ${marker.session_id ?? "?"}, rx: ${marker.rx_id ?? "?"}`);
    } catch { /* skip */ }
  }

  // ── Evidence items ──────────────────────────
  const configDir = resolve(repoRoot, ".claude", "quorum");
  let watchFile = "docs/feedback/claude.md";
  const configPath = resolve(configDir, "config.json");
  if (existsSync(configPath)) {
    try {
      const cfg = JSON.parse(readFileSync(configPath, "utf8"));
      watchFile = cfg.consensus?.watch_file ?? watchFile;
    } catch { /* default */ }
  }

  // Check main repo + all worktrees for evidence
  const evidencePaths = findAllEvidence(repoRoot, watchFile);

  if (evidencePaths.length > 0) {
    console.log(`  Evidence:`);
    for (const ep of evidencePaths) {
      const content = readFileSync(ep.path, "utf8");
      const items = parseEvidenceItems(content);
      const location = ep.worktree ? `\x1b[2m(worktree: ${ep.worktree})\x1b[0m` : "\x1b[2m(main)\x1b[0m";

      if (items.length === 0) {
        console.log(`    ${ep.label} ${location} — no items`);
      } else {
        console.log(`    ${ep.label} ${location}`);
        for (const item of items) {
          const icon = item.status === "approved" ? "\x1b[32m✓\x1b[0m"
            : item.status === "rejected" ? "\x1b[31m✗\x1b[0m"
            : "\x1b[33m◐\x1b[0m";
          console.log(`      ${icon} ${item.title}`);
        }
      }
    }
  } else {
    console.log(`  Evidence:    ${watchFile} \x1b[2m(not found)\x1b[0m`);
  }

  // ── Active worktrees ────────────────────────
  const worktrees = getActiveWorktrees(repoRoot);
  if (worktrees.length > 0) {
    console.log(`  Worktrees:   ${worktrees.length} active`);
    for (const wt of worktrees) {
      console.log(`    \x1b[36m${wt.name}\x1b[0m → ${wt.path}`);
    }
  }

  // ── Active agents ───────────────────────────
  const agentsDir = resolve(repoRoot, ".claude", "agents");
  if (existsSync(agentsDir)) {
    const agentFiles = readdirSync(agentsDir).filter((f) => f.endsWith(".json"));
    if (agentFiles.length > 0) {
      console.log(`  Agents:      ${agentFiles.length} registered`);
      for (const f of agentFiles) {
        try {
          const agent = JSON.parse(readFileSync(resolve(agentsDir, f), "utf8"));
          let alive = false;
          if (agent.pid) { try { process.kill(agent.pid, 0); alive = true; } catch { /* dead */ } }
          const icon = alive ? "\x1b[32m●\x1b[0m" : "\x1b[2m○\x1b[0m";
          console.log(`    ${icon} ${agent.name ?? f} (PID: ${agent.pid ?? "?"}, ${alive ? "running" : "dead"})`);
        } catch { /* skip */ }
      }
    }
  }

  // ── Git progress ────────────────────────────
  try {
    const output = execFileSync("git", ["log", "--oneline", "-5"], {
      cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
    });
    const commits = output.trim().split("\n").filter(Boolean);
    if (commits.length > 0) {
      console.log(`  Recent commits:`);
      for (const c of commits) {
        console.log(`    \x1b[2m${c}\x1b[0m`);
      }
    }
  } catch { /* not a git repo */ }

  // ── Event log ───────────────────────────────
  const dbPath = resolve(repoRoot, ".claude", "quorum-events.db");
  const logPath = resolve(repoRoot, ".claude", "quorum-events.jsonl");
  if (existsSync(dbPath)) {
    console.log(`  Event store: SQLite \x1b[2m(${dbPath})\x1b[0m`);
  } else if (existsSync(logPath)) {
    const lines = readFileSync(logPath, "utf8").trim().split("\n").filter(Boolean);
    console.log(`  Event log:   ${lines.length} events`);
  } else {
    console.log(`  Event log:   \x1b[2mnone\x1b[0m`);
  }

  console.log(`\n  \x1b[2mRun 'quorum daemon' for real-time TUI dashboard\x1b[0m\n`);
}

// ── Helpers ───────────────────────────────────

interface EvidencePath {
  path: string;
  label: string;
  worktree: string | null;
}

interface EvidenceItem {
  title: string;
  status: "pending" | "approved" | "rejected";
}

function findAllEvidence(repoRoot: string, watchFile: string): EvidencePath[] {
  const results: EvidencePath[] = [];

  // Main repo
  const mainPath = resolve(repoRoot, watchFile);
  if (existsSync(mainPath)) {
    results.push({ path: mainPath, label: watchFile, worktree: null });
  }

  // Worktrees
  const worktrees = getActiveWorktrees(repoRoot);
  for (const wt of worktrees) {
    const wtPath = resolve(wt.path, watchFile);
    if (existsSync(wtPath)) {
      results.push({ path: wtPath, label: watchFile, worktree: wt.name });
    }
  }

  return results;
}

function parseEvidenceItems(content: string): EvidenceItem[] {
  const items: EvidenceItem[] = [];

  for (const line of content.split(/\r?\n/)) {
    // Match "## [TAG] Title" pattern
    const match = line.match(/^##\s+\[([^\]]+)\]\s+(.*)/);
    if (!match) continue;

    const tag = match[1]!;
    const title = match[2]!.trim();

    let status: EvidenceItem["status"] = "pending";
    if (tag === "APPROVED" || tag === "합의완료") status = "approved";
    else if (tag === "CHANGES_REQUESTED" || tag === "계류") status = "rejected";

    items.push({ title, status });
  }

  return items;
}

interface Worktree {
  name: string;
  path: string;
}

function getActiveWorktrees(repoRoot: string): Worktree[] {
  try {
    const output = execFileSync("git", ["worktree", "list", "--porcelain"], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });

    const worktrees: Worktree[] = [];
    let currentPath = "";

    for (const line of output.split("\n")) {
      if (line.startsWith("worktree ")) {
        currentPath = line.slice(9).trim();
      } else if (line.startsWith("branch ") && currentPath && currentPath !== repoRoot) {
        const branch = line.slice(7).trim().replace("refs/heads/", "");
        worktrees.push({ name: branch, path: currentPath });
        currentPath = "";
      }
    }

    return worktrees;
  } catch {
    return [];
  }
}
