/**
 * quorum status — show current audit gate status, evidence items,
 * active worktrees, and agent processes.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve, basename } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";

export async function run(args: string[]): Promise<void> {
  // --attach: connect to running daemon TUI session via tmux/psmux
  if (args.includes("--attach")) {
    return attachToDashboard();
  }
  // --capture: grab a snapshot of the running daemon TUI
  if (args.includes("--capture")) {
    return captureDashboard();
  }

  const repoRoot = process.cwd();

  console.log("\n\x1b[36mquorum status\x1b[0m\n");

  // ── Gates ───────────────────────────────────
  // Audit gate: read audit-status.json marker
  const GATE_LABELS: Record<string, string> = {
    changes_requested: "\x1b[33m● PENDING\x1b[0m",
    approved: "\x1b[32m● APPROVED\x1b[0m",
    infra_failure: "\x1b[31m● INFRA_FAILURE\x1b[0m",
  };
  let auditGateLabel = "\x1b[32m● OPEN\x1b[0m";
  try {
    const status = JSON.parse(readFileSync(resolve(repoRoot, ".claude", "audit-status.json"), "utf8")) as { status?: string };
    auditGateLabel = GATE_LABELS[status.status ?? ""] ?? auditGateLabel;
  } catch { /* no status file — default to OPEN */ }
  console.log(`  Audit gate:  ${auditGateLabel}`);

  try {
    const marker = JSON.parse(readFileSync(resolve(repoRoot, ".session-state", "retro-marker.json"), "utf8")) as { retro_pending?: boolean; session_id?: string; rx_id?: string };
    if (marker.retro_pending) {
      console.log(`  Retro gate:  \x1b[31m● BLOCKED (Bash/Agent locked)\x1b[0m`);
      console.log(`               session: ${marker.session_id ?? "?"}, rx: ${marker.rx_id ?? "?"}`);
    } else {
      console.log(`  Retro gate:  \x1b[32m● OPEN\x1b[0m`);
    }
  } catch {
    console.log(`  Retro gate:  \x1b[32m● OPEN\x1b[0m`);
  }

  // ── Evidence items ──────────────────────────
  const configDir = resolve(repoRoot, ".claude", "quorum");
  let watchFile = "docs/feedback/claude.md";
  const configPath = resolve(configDir, "config.json");
  let roles: Record<string, string> | undefined;
  let auditorModel = "codex";
  if (existsSync(configPath)) {
    try {
      const cfg = JSON.parse(readFileSync(configPath, "utf8"));
      watchFile = cfg.consensus?.watch_file ?? watchFile;
      auditorModel = cfg.plugin?.auditor_model ?? auditorModel;
      if (cfg.consensus?.roles && typeof cfg.consensus.roles === "object") {
        roles = cfg.consensus.roles;
      }
    } catch { /* default */ }
  }

  // ── Auditor config ────────────────────────
  if (roles && Object.keys(roles).length > 0) {
    console.log(`  Auditor:     \x1b[36mper-role\x1b[0m`);
    for (const [role, spec] of Object.entries(roles)) {
      if (role === "default") continue;
      console.log(`    ${role}: \x1b[33m${spec}\x1b[0m`);
    }
    if (roles.default) console.log(`    default: \x1b[2m${roles.default}\x1b[0m`);
  } else {
    console.log(`  Auditor:     ${auditorModel}`);
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
      cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true,
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

  // ── Parliament ─────────────────────────────
  if (existsSync(dbPath)) {
    try {
      const { EventStore: ES } = await import("../../bus/store.js");
      const store = new ES({ dbPath });
      const sessions = store.query({ eventType: "parliament.session.digest" });
      if (sessions.length > 0) {
        console.log(`\n  \x1b[36mParliament\x1b[0m`);
        console.log(`  Sessions:    ${sessions.length}`);

        const last = sessions[sessions.length - 1]!;
        const verdict = last.payload.verdictResult as string ?? "—";
        const converged = last.payload.converged as boolean;
        console.log(`  Last verdict: ${verdict} ${converged ? "\x1b[32m(converged)\x1b[0m" : ""}`);

        // Check for pending amendments
        const proposeEvents = store.query({ eventType: "parliament.amendment.propose" });
        const resolveEvents = store.query({ eventType: "parliament.amendment.resolve" });
        const resolvedIds = new Set(resolveEvents.map(e => e.payload.amendmentId as string));
        const pending = proposeEvents.filter(e => !resolvedIds.has(e.payload.amendmentId as string)).length;
        if (pending > 0) console.log(`  Amendments:  \x1b[33m${pending} pending\x1b[0m`);

        // CPS available?
        const cpsLatest = store.getKV("parliament.cps.latest");
        if (cpsLatest) console.log(`  CPS:         \x1b[32mavailable\x1b[0m`);
      }
      store.close();
    } catch { /* non-critical */ }
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
  status: "pending" | "approved" | "rejected" | "infra_failure";
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
    else if (tag === "INFRA_FAILURE") status = "infra_failure";

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
      windowsHide: true,
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

// ── ProcessMux remote view ──────────────────

const DASHBOARD_SESSION = "quorum-dashboard";

function detectMuxBackend(): "tmux" | "psmux" | null {
  if (process.platform === "win32") {
    try {
      const r = spawnSync("psmux", ["--version"], { stdio: "ignore", timeout: 3000, windowsHide: true });
      if (r.status === 0) return "psmux";
      return null;
    } catch { return null; }
  }
  try {
    const r = spawnSync("tmux", ["-V"], { stdio: "ignore", timeout: 3000 });
    if (r.status === 0) return "tmux";
    return null;
  } catch { return null; }
}

function attachToDashboard(): void {
  const backend = detectMuxBackend();
  if (!backend) {
    console.log("No mux backend available (tmux or psmux). Run 'quorum daemon' directly.");
    return;
  }

  // Check if session exists
  if (backend === "tmux") {
    const check = spawnSync("tmux", ["has-session", "-t", DASHBOARD_SESSION], { stdio: "ignore" });
    if (check.status !== 0) {
      console.log(`No dashboard session '${DASHBOARD_SESSION}' found. Start with 'quorum daemon'.`);
      return;
    }
    console.log(`Attaching to ${DASHBOARD_SESSION}...`);
    spawnSync("tmux", ["attach", "-t", DASHBOARD_SESSION], { stdio: "inherit" });
  } else {
    const check = spawnSync("psmux", ["list"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true });
    if (!check.stdout?.includes(DASHBOARD_SESSION)) {
      console.log(`No dashboard session '${DASHBOARD_SESSION}' found. Start with 'quorum daemon'.`);
      return;
    }
    console.log(`Attaching to ${DASHBOARD_SESSION}...`);
    spawnSync("psmux", ["attach", DASHBOARD_SESSION], { stdio: "inherit", windowsHide: true });
  }
}

function captureDashboard(): void {
  const backend = detectMuxBackend();
  if (!backend) {
    console.log("No mux backend available.");
    return;
  }

  if (backend === "tmux") {
    const result = spawnSync("tmux", ["capture-pane", "-t", DASHBOARD_SESSION, "-p"], {
      encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
    });
    if (result.status === 0 && result.stdout) {
      console.log(result.stdout);
    } else {
      console.log(`No dashboard session '${DASHBOARD_SESSION}' found.`);
    }
  } else {
    const result = spawnSync("psmux", ["capture", DASHBOARD_SESSION, "--tail", "50"], {
      encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true,
    });
    if (result.status === 0 && result.stdout) {
      console.log(result.stdout);
    } else {
      console.log(`No dashboard session '${DASHBOARD_SESSION}' found.`);
    }
  }
}
