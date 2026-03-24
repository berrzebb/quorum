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
import { readAuditStatus, readRetroMarker, AUDIT_STATUS } from "../../adapters/shared/audit-state.mjs";
import { resolveRepoRoot } from "../../adapters/shared/repo-resolver.mjs";
import { createT } from "../../core/context.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Fast-path markers ────────────────────────────────────────
// Check cheapest signals first. If nothing is active → exit(0) immediately.

const REPO_ROOT = resolveRepoRoot({ adapterDir: __dirname });

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
const triggerTag = cfg.consensus?.trigger_tag ?? "[REVIEW_NEEDED]";
const agreeTag = cfg.consensus?.agree_tag ?? "[APPROVED]";
const pendingTag = cfg.consensus?.pending_tag ?? "[CHANGES_REQUESTED]";

// ── Collect status signals (file-based, no bridge needed) ────
const signals = [];

// 1. Retro pending? (cheapest check — small JSON file)
let retroPending = false;
{
  const m = readRetroMarker(__dirname);
  if (m?.retro_pending) {
    retroPending = true;
    signals.push(`⏳ ${t("signal.retro_pending")}`);
  }
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
