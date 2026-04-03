#!/usr/bin/env node
/**
 * Hook: SessionStart
 * Loads handoff + recent changes + audit state as context for new sessions.
 * Detects interrupted audit cycles and orchestrator tracks → provides resume instructions.
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { syncHandoffFromMemory } from "./handoff-writer.mjs";
import { readAuditStatus, readRetroMarker, AUDIT_STATUS } from "../../adapters/shared/audit-state.mjs";
import { resolveRepoRoot } from "../../adapters/shared/repo-resolver.mjs";
import { firstRunSetup, buildFirstRunMessage } from "../../adapters/shared/first-run.mjs";
import { createT } from "../../core/context.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolveRepoRoot({ adapterDir: __dirname });

const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT ?? __dirname;

// Use shared config resolver — checks project dir first, then env vars, then adapter dir.
import { findConfigPath } from "../../adapters/shared/config-resolver.mjs";
const configPath = findConfigPath({ repoRoot: REPO_ROOT, adapterDir: __dirname });

// ── config.json not found → auto-copy to project dir + prompt to customize ──
if (!configPath) {
  const projectConfigDir = resolve(REPO_ROOT, ".claude", "quorum");
  const result = firstRunSetup({ adapterRoot: pluginRoot, projectConfigDir });
  const msg = buildFirstRunMessage(result, resolve(pluginRoot, "README.md"));
  if (msg) {
    process.stdout.write(`{"additionalContext": ${JSON.stringify(msg)}}`);
    process.exit(0);
  }
  if (result.needsManualSetup) {
    process.stdout.write(`{"additionalContext": ${JSON.stringify(
      `[SETUP REQUIRED — quorum]\n\nconfig.json not found and examples/ directory is missing.\nReinstall the plugin: claude plugin add berrzebb/quorum`
    )}}`);
    process.exit(0);
  }
}

const cfg = JSON.parse(readFileSync(configPath, "utf8"));
const t = createT(cfg.plugin?.locale ?? "en");
const triggerTag = cfg.consensus?.trigger_tag ?? "[REVIEW_NEEDED]";
const agreeTag = cfg.consensus?.agree_tag ?? "[APPROVED]";
const pendingTag = cfg.consensus?.pending_tag ?? "[CHANGES_REQUESTED]";

let context = "";
const resumeActions = [];

// ── 0. Handoff sync ─────────────────────────────────────────
const handoffFile = cfg.plugin?.handoff_file ?? ".claude/session-handoff.md";
try {
  syncHandoffFromMemory(REPO_ROOT, handoffFile);
} catch (err) { console.warn(`[session-start] handoff sync failed: ${err?.message}`); }

// ── 1. Session handoff ──────────────────────────────────────
const handoff = resolve(REPO_ROOT, handoffFile);
let handoffContent = "";
if (existsSync(handoff)) {
  handoffContent = readFileSync(handoff, "utf8").trim();
  if (handoffContent) context += `Session Handoff:\n${handoffContent}\n\n`;
}

// ── 2. Recent git commits ───────────────────────────────────
try {
  const commits = execFileSync("git", ["log", "--oneline", "-10"], { cwd: REPO_ROOT, encoding: "utf8", windowsHide: true }).trim();
  if (commits) context += `Recent commits:\n${commits}\n\n`;
} catch (err) { console.warn(`[session-start] git log failed: ${err?.message}`); }

// ── 3. Resume detection ─────────────────────────────────────
// 3a. Audit status
const auditStatus = readAuditStatus(REPO_ROOT);
if (auditStatus) {
  if (auditStatus.status === AUDIT_STATUS.CHANGES_REQUESTED) {
    const rejectionCodes = auditStatus.rejectionCodes ?? [];
    resumeActions.push(
      t("resume.pending_corrections", {
        tag: pendingTag,
        codes: rejectionCodes.length > 0 ? `\n  Rejection codes: ${rejectionCodes.join(", ")}` : "",
      })
    );
  } else if (auditStatus.status === AUDIT_STATUS.APPROVED) {
    context += `${t("resume.approved_status", { tag: agreeTag })}\n`;
  }
}

// 3c. Retrospective state
const marker = readRetroMarker(__dirname);
if (marker?.retro_pending && marker.deferred_to_orchestrator) {
  resumeActions.push(
    t("resume.retro_deferred", { id: marker.rx_id ?? "unknown" })
    + (marker.agreed_items ? `\n  Agreed items:\n${marker.agreed_items}` : "")
  );
} else if (marker?.retro_pending) {
  resumeActions.push(t("resume.retro_pending", { id: marker.rx_id ?? "unknown" }));
}

// 3d. Orchestrator track detection from handoff
if (handoffContent) {
  const taskBlocks = handoffContent.split(/(?=^### \[)/m);
  const activeTasks = [];
  for (const block of taskBlocks) {
    const titleMatch = block.match(/^### \[([^\]]+)\]\s*(.+)/m);
    if (!titleMatch) continue;
    const statusMatch = block.match(/\*\*(?:상태|status)\*\*:\s*(.+)/i);
    if (!statusMatch) continue;
    const status = statusMatch[1].trim();
    if (/진행\s*중|in.?progress/i.test(status)) {
      activeTasks.push({ id: titleMatch[1], title: titleMatch[2].trim(), status });
    }
  }

  if (activeTasks.length > 0) {
    const taskList = activeTasks.map((tk) => `  - [${tk.id}] ${tk.title}`).join("\n");
    resumeActions.push(t("resume.active_tasks", { count: activeTasks.length, list: taskList }));
  }
}

// 3e. Compaction snapshot
const snapshotPath = resolve(REPO_ROOT, ".claude", "compaction-snapshot.json");
if (existsSync(snapshotPath)) {
  try {
    const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8"));
    const parts = [];
    if (snapshot.audit_in_progress) parts.push("audit in progress");
    if (snapshot.last_audit_status) parts.push(`last item: ${snapshot.last_audit_status}`);
    if (snapshot.retro_marker?.retro_pending) parts.push("retro pending");
    if (parts.length > 0) {
      context += `[Pre-compaction state — ${snapshot.saved_at}] ${parts.join(", ")}\n`;
    }
  } catch (err) { console.warn(`[session-start] snapshot parse error: ${err?.message}`); }
}

// ── 3f. Bridge: stagnation detection + learning load ──────────
try {
  const bridge = await import("../../core/bridge.mjs");
  await bridge.init(REPO_ROOT);

  // Stagnation detection — warn if patterns detected
  const stagnation = bridge.gate.detectStagnation?.();
  if (stagnation?.patterns?.length > 0) {
    const patternNames = stagnation.patterns.map(p => p.type).join(", ");
    resumeActions.push(`⚠ Stagnation detected: ${patternNames}. Consider decomposing the current task or switching approach.`);
  }

  // Load trigger weight adjustments from learning history
  const learnings = bridge.execution.analyzeAuditLearnings?.();
  if (learnings?.suggestions?.length > 0) {
    context += `Auto-learn suggestions (from audit history):\n`;
    for (const s of learnings.suggestions.slice(0, 3)) {
      context += `  - ${s}\n`;
    }
    context += `\n`;
  }

  bridge.close();
} catch (e) { /* bridge unavailable — fail-open */ }

// ── 3g. Orchestrate track dashboard ──────────────────────────
// Read wave-state files + track plans → show progress at session start.
try {
  const quorumDir = resolve(REPO_ROOT, ".claude", "quorum");
  if (existsSync(quorumDir)) {
    const waveFiles = readdirSync(quorumDir).filter(f => f.startsWith("wave-state-") && f.endsWith(".json"));
    if (waveFiles.length > 0) {
      const trackLines = [];
      const STALE_DAYS = 3;
      for (const wf of waveFiles) {
        try {
          const ws = JSON.parse(readFileSync(resolve(quorumDir, wf), "utf8"));
          const completed = ws.completedIds?.length ?? 0;
          const failed = ws.failedIds?.length ?? 0;
          const lastWave = (ws.lastCompletedWave ?? -1) + 1;

          // Stale detection: check updatedAt
          let staleMark = "";
          if (ws.updatedAt) {
            const daysSince = Math.floor((Date.now() - new Date(ws.updatedAt).getTime()) / 86400_000);
            if (daysSince >= STALE_DAYS) staleMark = ` ⚠ idle ${daysSince}d`;
          }

          // Progress bar (10-char block)
          const total = ws.totalItems ?? (completed + failed);
          const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
          const filled = Math.round(pct / 10);
          const bar = "█".repeat(filled) + "░".repeat(10 - filled);

          const fitnessLabel = ws.lastFitness != null ? ` fitness:${ws.lastFitness.toFixed(2)}` : "";
          const waveLabel = ws.totalWaves ? `wave ${lastWave}/${ws.totalWaves}` : `wave ${lastWave}`;
          trackLines.push(
            `  ${ws.trackName}: [${bar}] ${pct}% (${completed}/${total} done, ${failed} failed, ${waveLabel}${fitnessLabel})${staleMark}`
          );

          if (failed > 0) {
            resumeActions.push(
              `Track "${ws.trackName}" has ${failed} failed item(s). Run: quorum orchestrate run ${ws.trackName} --resume`
            );
          }
        } catch (err) { console.warn(`[session-start] corrupt wave-state ${wf}: ${err?.message}`); }
      }

      if (trackLines.length > 0) {
        context += `Orchestrate Tracks:\n${trackLines.join("\n")}\n\n`;
      }
    }
  }
} catch (err) { console.warn(`[session-start] track dashboard error: ${err?.message}`); }

// ── 4. Build resume context ─────────────────────────────────
if (resumeActions.length > 0) {
  context += `\n${"=".repeat(50)}\n`;
  context += `[RESUME REQUIRED — ${resumeActions.length} action(s)]\n`;
  context += `${"=".repeat(50)}\n\n`;
  for (let i = 0; i < resumeActions.length; i++) {
    context += `${i + 1}. ${resumeActions[i]}\n\n`;
  }
}

// ── 5. Context Reinforcement ────────────────────────────────
// Re-inject core protocol rules every session start so they survive context compression.
// Dynamically reads the "Absolute Rules" section from AGENTS.md (Policy as Data).
const locale = cfg.plugin?.locale ?? "en";
const guideDir = (() => {
  const pr = process.env.CLAUDE_PLUGIN_ROOT ?? __dirname;
  // New locale convention: docs/ (EN root), docs/ko-KR/ (Korean)
  const localeDir = locale === "ko" ? "ko-KR" : "";
  const p = resolve(pr, "docs", localeDir, "AGENTS.md");
  if (existsSync(p)) return p;
  // fallback: try root (English default)
  const p2 = resolve(pr, "docs", "AGENTS.md");
  if (existsSync(p2)) return p2;
  return null;
})();

if (guideDir) {
  try {
    const guideContent = readFileSync(guideDir, "utf8");
    const sectionMatch = guideContent.match(
      /^(## (?:절대 규칙|Absolute Rules)\s*\n(?:(?!^## ).+\n)*)/m
    );
    if (sectionMatch) {
      const rules = sectionMatch[1].trim();
      context += `\n<CONTEXT-REINFORCEMENT>\n`;
      context += `${rules}\n`;
      context += `\nRun /quorum:verify before evidence submission. Self-promotion (${agreeTag}) is strictly forbidden.\n`;
      context += `</CONTEXT-REINFORCEMENT>\n`;
    }
  } catch (err) { console.warn(`[session-start] AGENTS.md read error: ${err?.message}`); }
}

// ── Output ──────────────────────────────────────────────────
if (context) {
  const escaped = JSON.stringify(context);
  process.stdout.write(`{"additionalContext": ${escaped}}`);
}
