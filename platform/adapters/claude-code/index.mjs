#!/usr/bin/env node
/* global process, Buffer */
/**
 * PostToolUse hook: tag-based consensus loop + code quality auto-checks.
 *
 * (A) Evidence submission via audit_submit MCP tool → SQLite → audit
 * (B) quality_rules — run ESLint/npm audit immediately on matching file edits
 *
 * All behavior is controlled by config.json.
 * Verdicts and evidence are stored in SQLite (single source of truth).
 */
import { readFileSync, existsSync, appendFileSync, statSync, writeFileSync, openSync, closeSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync, execFileSync } from "node:child_process";
import { execResolved } from "../../core/cli-runner.mjs";
import {
  HOOKS_DIR, REPO_ROOT, cfg, plugin, consensus as c,
  t, isHookEnabled, configMissing,
} from "../../core/context.mjs";
import { readAuditStatus, AUDIT_STATUS } from "../../adapters/shared/audit-state.mjs";
import { runParliamentIfEnabled } from "../../adapters/shared/parliament-runner.mjs";
import * as bridge from "../../core/bridge.mjs";

const debugLog = resolve(HOOKS_DIR, plugin.debug_log ?? "debug.log");
const ackFile  = resolve(HOOKS_DIR, plugin.ack_file ?? "ack.timestamp");

function log(msg) {
  const ts = new Date().toISOString().replace("T", " ").slice(0, 19);
  appendFileSync(debugLog, `[${ts}] ${msg}\n`);
}

// Use memoized path resolvers from context.mjs
// Evidence submission via audit_submit MCP tool

/** Pre-computed required section patterns (cached on first call). */
let _cachedRequired = null;

/** Cached plan doc existence check (stable within session). */
let _hasPlanDoc = null;

/** Pre-validate evidence package format — regex-based, zero tokens. */
// validate_evidence_format removed — migrated to audit_submit MCP tool (platform/core/tools/tool-core.mjs)

function get_mtime(p) { try { return statSync(p).mtimeMs; } catch { return 0; } }
function read_ack()   { try { return Number(readFileSync(ackFile, "utf8").trim()) || 0; } catch { return 0; } }
function write_ack(ms) { writeFileSync(ackFile, String(ms), "utf8"); }

// has_trigger removed — evidence via audit_submit MCP tool
function has_agreed(content)  { return !content.includes(c.trigger_tag); }

function run_script(absPath, args = []) {
  if (!existsSync(absPath)) { log(`SKIP: ${absPath} not found`); return null; }
  const result = spawnSync(process.execPath, [absPath, ...args], {
    cwd: REPO_ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
    env: { ...process.env, FEEDBACK_LOOP_ACTIVE: "1" },
    windowsHide: true,
  });
  if (result.error) { log(`ERROR: ${result.error.message}`); return null; }
  const err = (result.stderr || "").trim();
  if (err) log(`STDERR: ${err.split("\n")[0]}`);
  const out = (result.stdout || "").trim();
  if (out) log(`OUT: ${out.split("\n")[0]}`);
  return { status: result.status, stdout: out };
}

// run_audit removed — audit is now triggered by audit_submit MCP tool

/** If audit-status.json is newer than last ack → auto-sync via respond_script. */
function check_pending_response() {
  const auditStatusPath = resolve(REPO_ROOT, ".claude", "audit-status.json");
  const statusMtime = get_mtime(auditStatusPath);
  if (statusMtime === 0) return;

  const lastAck = read_ack();
  if (statusMtime <= lastAck) return;

  log("NOTIFY: pending response — auto-sync");
  const result = run_script(resolve(HOOKS_DIR, plugin.respond_script));
  write_ack(Math.max(statusMtime, get_mtime(auditStatusPath)));
  if (result?.stdout) process.stdout.write(t("index.sync.output", { out: result.stdout }));

  const status = readAuditStatus(REPO_ROOT);
  if (status?.status === AUDIT_STATUS.APPROVED) {
    process.stdout.write(t("index.sync.arrived_agreed", { tag: c.agree_tag }));
  } else if (status) {
    const statusMsg = `status: ${status.status}, pending: ${status.pendingCount}, codes: ${(status.rejectionCodes ?? []).join(", ")}`;
    process.stdout.write(t("index.sync.arrived_pending", { tag: c.pending_tag, content: statusMsg }));
  }
}

/** (C) quality_rules — match file extension/name → run immediate check. */
function run_quality_checks(filePath) {
  const normalized = filePath.replace(/\\/g, "/");
  const filename   = filePath.split(/[\\/]/).pop() ?? "";
  if (normalized.includes("/node_modules/")) return;

  // Support both legacy array format and new preset object format
  const qr = cfg.quality_rules;
  const rules = Array.isArray(qr) ? qr : [];

  // If preset format: resolve active presets by detect file presence
  if (qr && !Array.isArray(qr) && Array.isArray(qr.presets)) {
    const activePresets = qr.presets.filter(p => existsSync(resolve(REPO_ROOT, p.detect)));
    for (const preset of activePresets) {
      for (const check of preset.checks ?? []) {
        if (check.per_file) {
          const envRef = process.platform === "win32" ? "%HOOK_TARGET_FILE%" : "$HOOK_TARGET_FILE";
          const cmd = check.command.replace("{file}", envRef);
          const result = spawnSync(cmd, {
            cwd: REPO_ROOT, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", shell: process.platform === "win32" ? process.env.COMSPEC || "cmd.exe" : true, windowsHide: true,
            env: { ...process.env, HOOK_TARGET_FILE: filePath },
          });
          const output = ((result.stdout || "") + (result.stderr || "")).trim();
          if (result.status !== 0 && output && !check.optional) {
            process.stdout.write(t("index.check.error", { label: check.label, file: filename, output }));
          }
        }
      }
    }
    return;
  }

  // Legacy array format
  for (const rule of rules) {
    const m = rule.match;
    if (m.extension && !normalized.endsWith(m.extension)) continue;
    if (m.path_contains && !m.path_contains.some((p) => normalized.includes(p))) continue;
    if (m.filenames && !m.filenames.includes(filename)) continue;

    const envRef = process.platform === "win32" ? "%HOOK_TARGET_FILE%" : "$HOOK_TARGET_FILE";
    const cmd = rule.command.replace("{file}", envRef);
    const result = spawnSync(cmd, {
      cwd: REPO_ROOT, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", shell: process.platform === "win32" ? process.env.COMSPEC || "cmd.exe" : true, windowsHide: true,
      env: { ...process.env, HOOK_TARGET_FILE: filePath },
    });
    const output = ((result.stdout || "") + (result.stderr || "")).trim();
    if (result.status !== 0 && output) {
      process.stdout.write(t("index.check.error", { label: rule.label, file: filename, output }));
    }
  }
}

async function main() {
  log("Hook triggered");
  if (configMissing) {
    process.stdout.write("[quorum] config.json not found. Run a new session to trigger auto-setup, or see README.md for manual configuration.");
    return;
  }
  if (process.env.FEEDBACK_LOOP_ACTIVE === "1") { log("EXIT: reentrant"); return; }

  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) { log("EXIT: empty stdin"); return; }

  let payload;
  try { payload = JSON.parse(raw); } catch {
    log("EXIT: JSON parse error");
    check_pending_response();
    return;
  }

  // Propagate session_id via env — downstream scripts (retrospective.mjs) record it in markers
  const sessionId = payload?.session_id || "";
  if (sessionId) {
    process.env.RETRO_SESSION_ID = sessionId;
  }

  const toolName = String(payload?.tool_name ?? "unknown");
  const filePath = String(payload?.tool_input?.file_path ?? "");
  log(`tool=${toolName} file_path=${filePath}`);
  const normalized = filePath.replace(/\\/g, "/").toLowerCase();

  // (C) Code quality immediate check
  if (isHookEnabled("quality_rules")) {
    run_quality_checks(filePath);
  }

  // (A) Evidence via audit_submit MCP tool — no hook-side detection.
  // Evidence submission is now via `audit_submit` MCP tool (no file I/O).
  // See: platform/core/tools/tool-core.mjs → toolAuditSubmit()

  // Other file edited → check for pending response
  check_pending_response();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => log(`FATAL: ${err.message}`));
}

