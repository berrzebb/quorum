#!/usr/bin/env node
/**
 * Hook: UserPromptSubmit
 * Injects real-time audit/retro status into every user prompt as additionalContext.
 *
 * Design: fast-path exit when no state → zero-overhead on normal prompts.
 * Only loads bridge + reads files when audit-related state exists.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { readAuditStatus, AUDIT_STATUS } from "../../adapters/shared/audit-state.mjs";
import { createT } from "../../core/context.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Fast-path markers ────────────────────────────────────────
// Check cheapest signals first. If nothing is active → exit(0) immediately.

function resolveRepoRoot() {
  try {
    const r = spawnSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: process.cwd(), encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"], windowsHide: true,
    });
    if (r.status === 0) return r.stdout.trim();
  } catch { /* git unavailable */ }
  const legacy = resolve(__dirname, "..", "..", "..");
  if (existsSync(resolve(legacy, ".git"))) return legacy;
  return process.cwd();
}

const REPO_ROOT = resolveRepoRoot();

// Read config
const configPath = (() => {
  const pr = process.env.CLAUDE_PLUGIN_ROOT;
  if (pr) { const p = resolve(pr, "config.json"); if (existsSync(p)) return p; }
  const local = resolve(__dirname, "config.json");
  return existsSync(local) ? local : null;
})();
if (!configPath) process.exit(0);

let cfg;
try { cfg = JSON.parse(readFileSync(configPath, "utf8")); } catch { process.exit(0); }

const locale = cfg.plugin?.locale ?? "en";
const t = createT(locale);
const watchFile = cfg.consensus?.watch_file ?? "docs/feedback/claude.md";
const triggerTag = cfg.consensus?.trigger_tag ?? "[GPT미검증]";
const agreeTag = cfg.consensus?.agree_tag ?? "[합의완료]";
const pendingTag = cfg.consensus?.pending_tag ?? "[계류]";

// ── Collect status signals (file-based, no bridge needed) ────
const signals = [];

// 1. Retro pending? (cheapest check — small JSON file)
const retroMarker = resolve(__dirname, ".session-state", "retro-marker.json");
let retroPending = false;
if (existsSync(retroMarker)) {
  try {
    const m = JSON.parse(readFileSync(retroMarker, "utf8"));
    if (m.retro_pending) {
      retroPending = true;
      signals.push(`⏳ ${t("signal.retro_pending")}`);
    }
  } catch { /* parse error */ }
}

// 2. Audit status
const auditStatus = readAuditStatus(REPO_ROOT);
if (auditStatus) {
  if (auditStatus.status === AUDIT_STATUS.CHANGES_REQUESTED) {
    const codeCount = auditStatus.rejectionCodes?.length ?? 0;
    signals.push(`❌ ${t("signal.pending_corrections", { tag: pendingTag, count: codeCount })}`);
  } else if (auditStatus.status === AUDIT_STATUS.APPROVED) {
    signals.push(`✅ ${t("signal.approved", { tag: agreeTag })}`);
  }
}

// ── No signals → fast exit ───────────────────────────────────
if (signals.length === 0) process.exit(0);

// ── Build context ────────────────────────────────────────────
const context = `[quorum status] ${signals.join(" | ")}`;
const escaped = JSON.stringify(context);
process.stdout.write(`{"additionalContext": ${escaped}}`);
