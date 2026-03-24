#!/usr/bin/env node
/**
 * PreCompact hook: save audit state snapshot before context compaction.
 *
 * Restored at SessionStart after compaction to maintain audit cycle continuity.
 * Saved state: retro-marker, last audit status (audit-status.json).
 *
 * Fail-open: all errors are ignored and stdin is passed through as-is.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readAuditStatus } from "../../adapters/shared/audit-state.mjs";
import { execFileSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));

function resolveRepoRoot() {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: process.cwd(), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true,
    }).trim();
  } catch { /* fallback */ }
  const legacy = resolve(__dirname, "..", "..", "..");
  if (existsSync(resolve(legacy, ".git"))) return legacy;
  return process.cwd();
}

function loadConfig() {
  const pr = process.env.CLAUDE_PLUGIN_ROOT;
  if (pr) {
    const p = resolve(pr, "config.json");
    if (existsSync(p)) return JSON.parse(readFileSync(p, "utf8"));
  }
  const local = resolve(__dirname, "config.json");
  return existsSync(local) ? JSON.parse(readFileSync(local, "utf8")) : {};
}

try {
  const cfg = loadConfig();

  // Hook toggle — skip snapshot when disabled
  if (cfg.plugin?.hooks_enabled?.pre_compact === false) throw new Error("disabled");

  const REPO_ROOT = resolveRepoRoot();
  const claudeDir = resolve(REPO_ROOT, ".claude");
  const snapshotPath = resolve(claudeDir, "compaction-snapshot.json");

  // 1. retro-marker state
  const markerPath = resolve(__dirname, ".session-state", "retro-marker.json");
  let retroMarker = null;
  if (existsSync(markerPath)) {
    try { retroMarker = JSON.parse(readFileSync(markerPath, "utf8")); } catch { /* */ }
  }

  // 2. Audit status
  const status = readAuditStatus(resolve(claudeDir, ".."));
  const lastAuditStatus = status
    ? `${status.status ?? "unknown"} (pending: ${status.pendingCount ?? 0})`
    : null;

  // 4. Save snapshot
  if (!existsSync(claudeDir)) mkdirSync(claudeDir, { recursive: true });
  writeFileSync(snapshotPath, JSON.stringify({
    saved_at: new Date().toISOString(),
    retro_marker: retroMarker,
    last_audit_status: lastAuditStatus,
  }, null, 2), "utf8");
} catch {
  // Fail-open: on error (including toggle disabled) do nothing
}

// stdin pass-through
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
process.stdout.write(Buffer.concat(chunks));
