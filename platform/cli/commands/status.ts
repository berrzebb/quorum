/**
 * quorum status — show current audit gate status, evidence items,
 * active worktrees, and agent processes.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { AUDIT_VERDICT } from "../../bus/events.js";

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
    [AUDIT_VERDICT.CHANGES_REQUESTED]: "\x1b[33m● PENDING\x1b[0m",
    [AUDIT_VERDICT.APPROVED]: "\x1b[32m● APPROVED\x1b[0m",
    [AUDIT_VERDICT.INFRA_FAILURE]: "\x1b[31m● INFRA_FAILURE\x1b[0m",
  };
  let auditGateLabel = "\x1b[32m● OPEN\x1b[0m";
  try {
    const status = JSON.parse(readFileSync(resolve(repoRoot, ".claude", "audit-status.json"), "utf8")) as { status?: string };
    auditGateLabel = GATE_LABELS[status.status ?? ""] ?? auditGateLabel;
  } catch { /* no audit-status.json yet → OPEN (default) */ }
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
  const configPath = resolve(configDir, "config.json");
  let roles: Record<string, string> | undefined;
  let auditorModel = "codex";
  if (existsSync(configPath)) {
    try {
      const cfg = JSON.parse(readFileSync(configPath, "utf8"));
      auditorModel = cfg.plugin?.auditor_model ?? auditorModel;
      if (cfg.consensus?.roles && typeof cfg.consensus.roles === "object") {
        roles = cfg.consensus.roles;
      }
    } catch (err) { console.warn(`[status] config parse failed: ${(err as Error).message}`); }
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

  // Evidence from SQLite EventStore (single source of truth)
  const dbPath = resolve(repoRoot, ".claude", "quorum-events.db");
  const worktrees = getActiveWorktrees(repoRoot);
  let evidenceDisplayed = false;
  if (existsSync(dbPath)) {
    try {
      const { EventStore: EvidenceStore } = await import("../../bus/store.js");
      const eStore = new EvidenceStore({ dbPath });
      const evidenceEvents = eStore.query({ eventType: "evidence.write" });
      const verdictEvents = eStore.query({ eventType: "audit.verdict" });
      const verdictMap = new Map<string, string>();
      for (const v of verdictEvents) {
        const id = (v.payload as any)?.itemId ?? (v.payload as any)?.entityId;
        if (id) verdictMap.set(id, (v.payload as any)?.verdict ?? "pending");
      }

      if (evidenceEvents.length > 0) {
        console.log(`  Evidence:    \x1b[36m${evidenceEvents.length} submission(s)\x1b[0m \x1b[2m(SQLite)\x1b[0m`);
        // Show last 5 submissions
        const recent = evidenceEvents.slice(-5);
        for (const ev of recent) {
          const p = ev.payload as any;
          const files = p?.changedFiles?.length ?? 0;
          const ts = new Date(ev.timestamp).toLocaleString("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
          const verdict = verdictMap.get(ev.sessionId ?? "") ?? "";
          const icon = verdict === "approved" ? "\x1b[32m✓\x1b[0m"
            : verdict === "changes_requested" ? "\x1b[31m✗\x1b[0m"
            : "\x1b[33m◐\x1b[0m";
          console.log(`    ${icon} ${ts} — ${files} file(s) from ${ev.source}`);
        }
        evidenceDisplayed = true;
      }
      eStore.close();
    } catch (err) { console.warn(`[status] evidence query failed: ${(err as Error).message}`); }
  }
  if (!evidenceDisplayed) {
    console.log(`  Evidence:    \x1b[2mnone\x1b[0m`);
  }

  // ── Active worktrees ────────────────────────
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
          if (agent.pid) {
            try { process.kill(agent.pid, 0); alive = true; } catch (err) { console.warn(`[status] agent pid ${agent.pid} not running: ${(err as Error).message}`); }
          } else if (agent.backend === "psmux" || agent.backend === "tmux") {
            // Mux sessions: check if session still exists in backend
            try {
              const cmd = agent.backend === "psmux" ? "psmux" : "tmux";
              const listArgs = ["list-sessions", "-F", "#{session_name}"];
              const result = spawnSync(cmd, listArgs, { encoding: "utf8", timeout: 3000, windowsHide: true });
              alive = (result.stdout ?? "").includes(agent.name);
            } catch (err) { console.warn(`[status] mux session check failed: ${(err as Error).message}`); }
          }
          const icon = alive ? "\x1b[32m●\x1b[0m" : "\x1b[2m○\x1b[0m";
          const role = agent.role ? ` (${agent.role})` : "";
          const be = agent.backend ? ` [${agent.backend}]` : "";
          console.log(`    ${icon} ${agent.name ?? f}${be}${role} ${alive ? "\x1b[32mrunning\x1b[0m" : "\x1b[2mdead\x1b[0m"}`);
        } catch (err) { console.warn(`[status] agent state parse failed for ${f}: ${(err as Error).message}`); }
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
  } catch (err) { console.warn(`[status] git log failed: ${(err as Error).message}`); }

  // ── Event log ───────────────────────────────
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
        const { getPendingAmendmentCount } = await import("../../bus/amendment.js");
        const pending = getPendingAmendmentCount(store);
        if (pending > 0) console.log(`  Amendments:  \x1b[33m${pending} pending\x1b[0m`);

        // CPS available?
        const cpsLatest = store.getKV("parliament.cps.latest");
        if (cpsLatest) console.log(`  CPS:         \x1b[32mavailable\x1b[0m`);
      }
      store.close();
    } catch (err) { console.warn(`[status] parliament data query failed: ${(err as Error).message}`); }
  }

  console.log(`\n  \x1b[2mRun 'quorum daemon' for real-time TUI dashboard\x1b[0m\n`);
}

// ── Helpers ───────────────────────────────────

// EvidencePath and EvidenceItem removed — evidence now from SQLite

// findAllEvidence and parseEvidenceItems removed — evidence now read from SQLite EventStore

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
  } catch (err) {
    console.warn(`[status] getActiveWorktrees failed: ${(err as Error).message}`);
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
    } catch (err) { console.warn(`[status] psmux detection failed: ${(err as Error).message}`); return null; }
  }
  try {
    const r = spawnSync("tmux", ["-V"], { stdio: "ignore", timeout: 3000 });
    if (r.status === 0) return "tmux";
    return null;
  } catch (err) { console.warn(`[status] tmux detection failed: ${(err as Error).message}`); return null; }
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
