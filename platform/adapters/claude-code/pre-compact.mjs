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
import { readAuditStatus, readRetroMarker } from "../../adapters/shared/audit-state.mjs";
import { resolveRepoRoot } from "../../adapters/shared/repo-resolver.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

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

  const REPO_ROOT = resolveRepoRoot({ adapterDir: __dirname });
  const claudeDir = resolve(REPO_ROOT, ".claude");
  const snapshotPath = resolve(claudeDir, "compaction-snapshot.json");

  // 1. retro-marker state
  const retroMarker = readRetroMarker(__dirname);

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
} catch (err) {
  // Fail-open: on error (including toggle disabled) do nothing
  console.warn(`[pre-compact] snapshot save failed: ${err?.message}`);
}

// stdin pass-through
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
process.stdout.write(Buffer.concat(chunks));
