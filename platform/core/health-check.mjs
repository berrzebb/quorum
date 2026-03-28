/**
 * Health Check — diagnose issues that could trap agents.
 *
 * Scans for:
 * - Orphan retro markers (retro-marker without active session)
 * - Stagnation in audit history (spinning/oscillation)
 * - Zombie worktrees (branch deleted but directory remains)
 * - Config mismatches (planning_dirs pointing to nonexistent dirs)
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve, relative } from "node:path";
import { execFileSync } from "node:child_process";

export function runHealthCheck(repoRoot) {
  const issues = [];

  checkRetroMarkers(repoRoot, issues);
  checkAuditStagnation(repoRoot, issues);
  checkWorktrees(repoRoot, issues);
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

    // Watch file check removed — evidence is in SQLite via audit_submit tool
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
