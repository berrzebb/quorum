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
      signals.push("⏳ 회고 미완료 — Bash/Agent 차단 중. `echo session-self-improvement-complete` 로 해제");
    }
  } catch { /* parse error */ }
}

// 2. Audit lock active?
const auditLock = resolve(REPO_ROOT, ".claude", "audit.lock");
if (existsSync(auditLock)) {
  try {
    const lock = JSON.parse(readFileSync(auditLock, "utf8"));
    const ageMin = Math.round((Date.now() - (lock.startedAt ?? 0)) / 60000);
    // PID liveness check
    let alive = false;
    if (lock.pid) { try { process.kill(lock.pid, 0); alive = true; } catch { /* dead */ } }
    if (alive) {
      signals.push(`🔍 감사 진행 중 (PID ${lock.pid}, ${ageMin}분 경과) — 커밋 대기`);
    }
  } catch { /* lock parse error */ }
}

// 3. Audit status (from audit-status.json marker — no verdict file needed)
const watchPath = resolve(REPO_ROOT, watchFile);
const auditStatusPath = resolve(REPO_ROOT, ".claude", "audit-status.json");

if (existsSync(watchPath)) {
  try {
    const wc = readFileSync(watchPath, "utf8");
    const hasTrigger = wc.includes(triggerTag);

    // Read audit status from marker file
    let auditStatus = null;
    if (existsSync(auditStatusPath)) {
      try { auditStatus = JSON.parse(readFileSync(auditStatusPath, "utf8")); } catch { /* parse error */ }
    }

    const isPending = auditStatus?.status === "changes_requested";
    const isApproved = auditStatus?.status === "approved";

    if (isPending && hasTrigger) {
      const codeCount = auditStatus.rejectionCodes?.length ?? 0;
      signals.push(`❌ ${pendingTag} 보정 필요 (반려 ${codeCount}건) — 감사 결과 확인 후 수정 & 재제출`);
    } else if (hasTrigger && !isPending && !isApproved && !existsSync(auditLock)) {
      signals.push(`📋 ${triggerTag} 제출됨 — 감사 대기 중`);
    } else if (isApproved && !hasTrigger) {
      signals.push(`✅ ${agreeTag} — 커밋 가능`);
    }
  } catch { /* watch file read error */ }
}

// ── No signals → fast exit ───────────────────────────────────
if (signals.length === 0) process.exit(0);

// ── Build context ────────────────────────────────────────────
const context = `[quorum status] ${signals.join(" | ")}`;
const escaped = JSON.stringify(context);
process.stdout.write(`{"additionalContext": ${escaped}}`);
