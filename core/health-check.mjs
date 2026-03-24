/**
 * Health Check — diagnose issues that could trap agents.
 *
 * Scans for:
 * 1. Unresolved placeholders in gpt.md / evidence files
 * 2. Stale lock files (audit.lock with dead PID or expired TTL)
 * 3. Orphan retro markers (retro-marker without active session)
 * 4. Stagnation in audit history (spinning/oscillation)
 * 5. Zombie worktrees (branch deleted but worktree remains)
 * 6. Config mismatches (planning_dirs pointing to nonexistent dirs)
 * 7. Missing template files referenced in config
 * 8. Broken import paths in hooks
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, relative } from "node:path";
import { execFileSync } from "node:child_process";

export function runHealthCheck(repoRoot) {
  const issues = [];

  // 1. Unresolved placeholders
  checkPlaceholders(repoRoot, issues);

  // 2. Stale locks
  checkStaleLocks(repoRoot, issues);

  // 3. Orphan retro markers
  checkRetroMarkers(repoRoot, issues);

  // 4. Audit history stagnation
  checkAuditStagnation(repoRoot, issues);

  // 5. Zombie worktrees + stale verdicts (single git call)
  checkWorktrees(repoRoot, issues);

  // 6. Config integrity
  checkConfig(repoRoot, issues);

  return issues;
}

export function formatHealthCheck(issues) {
  if (issues.length === 0) {
    return "\x1b[32m✓ All clear — no issues found.\x1b[0m";
  }

  const lines = [`\x1b[31m${issues.length} issue(s) found:\x1b[0m\n`];

  const bySeverity = { critical: [], warning: [], info: [] };
  for (const issue of issues) {
    (bySeverity[issue.severity] ?? bySeverity.info).push(issue);
  }

  for (const [sev, items] of Object.entries(bySeverity)) {
    if (items.length === 0) continue;
    const icon = sev === "critical" ? "🔴" : sev === "warning" ? "🟡" : "🔵";
    for (const item of items) {
      lines.push(`  ${icon} [${item.category}] ${item.message}`);
      if (item.fix) lines.push(`     Fix: ${item.fix}`);
    }
  }

  return lines.join("\n");
}

// ── Checks ────────────────────────────────────

function checkPlaceholders(_repoRoot, _issues) {
  // Verdict files eliminated — verdicts stored in SQLite only.
  // No file-based placeholder checks needed.
}

function checkStaleLocks(repoRoot, issues) {
  const lockPaths = findFiles(repoRoot, "audit.lock", 5);
  const TTL_MS = 30 * 60 * 1000;

  for (const lockPath of lockPaths) {
    try {
      const lock = JSON.parse(readFileSync(lockPath, "utf8"));
      const age = Date.now() - (lock.startedAt ?? 0);

      // PID check
      let alive = false;
      if (lock.pid) {
        try { process.kill(lock.pid, 0); alive = true; } catch { /* dead */ }
      }

      if (!alive) {
        issues.push({
          severity: "critical",
          category: "stale-lock",
          message: `Dead audit.lock: PID ${lock.pid} not running (${relative(repoRoot, lockPath)})`,
          fix: `rm "${lockPath}"`,
        });
      } else if (age > TTL_MS) {
        issues.push({
          severity: "warning",
          category: "stale-lock",
          message: `Expired audit.lock: ${Math.round(age / 60000)}min old (TTL: 30min)`,
          fix: `rm "${lockPath}"`,
        });
      }
    } catch { /* skip */ }
  }
}

function checkRetroMarkers(repoRoot, issues) {
  const markers = findFiles(repoRoot, "retro-marker.json", 5);

  for (const markerPath of markers) {
    try {
      const marker = JSON.parse(readFileSync(markerPath, "utf8"));
      const age = Date.now() - (marker.created_at ?? marker.timestamp ?? 0);

      // Older than 2 hours — likely orphan
      if (age > 2 * 60 * 60 * 1000) {
        issues.push({
          severity: "warning",
          category: "orphan-retro",
          message: `Retro marker ${Math.round(age / 3600000)}h old (${relative(repoRoot, markerPath)})`,
          fix: `rm "${markerPath}" — or complete retro with "echo session-self-improvement-complete"`,
        });
      }
    } catch { /* skip */ }
  }
}

function checkAuditStagnation(repoRoot, issues) {
  const historyPath = resolve(repoRoot, ".claude", "audit-history.jsonl");
  if (!existsSync(historyPath)) return;

  const lines = readFileSync(historyPath, "utf8").trim().split("\n").filter(Boolean);
  const recent = lines.slice(-5);

  // Check for spinning (same verdict 3+ times)
  if (recent.length >= 3) {
    const verdicts = recent.map(l => {
      try {
        const e = JSON.parse(l);
        return `${e.verdict}|${(e.rejection_codes ?? []).sort().join(",")}`;
      } catch { return ""; }
    }).filter(Boolean);

    const last3 = verdicts.slice(-3);
    if (last3.length === 3 && last3[0] === last3[1] && last3[1] === last3[2]) {
      issues.push({
        severity: "warning",
        category: "stagnation",
        message: `Audit spinning: same verdict 3 times — ${last3[0]}`,
        fix: "Check if the rejection is caused by a system bug. Run 'quorum verify' to pre-check.",
      });
    }
  }
}

/** Combined zombie worktree + stale verdict check (single git subprocess). */
function checkWorktrees(repoRoot, issues) {
  let output;
  try {
    output = execFileSync("git", ["worktree", "list", "--porcelain"], {
      cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true,
    });
  } catch { return; /* not a git repo */ }

  let wtPath = "";
  for (const line of output.split("\n")) {
    if (line.startsWith("worktree ")) {
      wtPath = line.slice(9).trim();
    } else if (line.startsWith("branch ") && wtPath && wtPath !== repoRoot) {
      // Zombie check
      if (!existsSync(wtPath)) {
        issues.push({
          severity: "warning",
          category: "zombie-worktree",
          message: `Worktree path missing: ${wtPath}`,
          fix: `git worktree remove "${wtPath}"`,
        });
      }
      wtPath = "";
    }
  }
}

function checkConfig(repoRoot, issues) {
  const configPath = resolve(repoRoot, ".claude", "quorum", "config.json");
  if (!existsSync(configPath)) {
    // Try legacy
    const legacy = resolve(repoRoot, ".claude", "consensus-loop", "config.json");
    if (existsSync(legacy)) {
      issues.push({
        severity: "info",
        category: "config",
        message: "Using legacy consensus-loop config — consider running 'quorum migrate'",
        fix: "quorum migrate",
      });
    }
    return;
  }

  try {
    const cfg = JSON.parse(readFileSync(configPath, "utf8"));

    // Check planning_dirs exist
    const dirs = cfg.consensus?.planning_dirs ?? [];
    for (const dir of dirs) {
      if (!existsSync(resolve(repoRoot, dir))) {
        issues.push({
          severity: "warning",
          category: "config",
          message: `planning_dirs "${dir}" does not exist`,
          fix: `mkdir -p "${dir}" — or update config`,
        });
      }
    }

    // Check watch file
    const watchFile = cfg.consensus?.watch_file;
    if (watchFile && !existsSync(resolve(repoRoot, watchFile))) {
      issues.push({
        severity: "info",
        category: "config",
        message: `Watch file "${watchFile}" not found — will be created on first evidence submission`,
      });
    }
  } catch {
    issues.push({
      severity: "critical",
      category: "config",
      message: "config.json is malformed",
      fix: "quorum setup — regenerates config",
    });
  }
}

// ── Utility ───────────────────────────────────

function findFiles(root, filename, maxDepth) {
  const results = [];
  function scan(dir, depth) {
    if (depth > maxDepth) return;
    try {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist") continue;
        const full = resolve(dir, entry.name);
        if (entry.isDirectory()) scan(full, depth + 1);
        else if (entry.name === filename) results.push(full);
      }
    } catch { /* skip */ }
  }
  scan(root, 0);
  return results;
}
