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
import { scanProject } from "../../adapters/shared/project-scanner.mjs";
import { buildInterviewQuestions, getActiveQuestions } from "../../adapters/shared/setup-interview.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolveRepoRoot({ adapterDir: __dirname });

const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT ?? __dirname;

// Use shared config resolver — checks project dir first, then env vars, then adapter dir.
import { findConfigPath } from "../../adapters/shared/config-resolver.mjs";
const configPath = findConfigPath({ repoRoot: REPO_ROOT, adapterDir: __dirname });

// ── config.json not found → auto-setup (PRD § 6.6) ─────────────────────
if (!configPath) {
  const projectConfigDir = resolve(REPO_ROOT, ".claude", "quorum");
  const setupStatePath = resolve(projectConfigDir, "setup-state.json");

  // Check if interview is already pending (multi-turn)
  let setupState = null;
  if (existsSync(setupStatePath)) {
    try { setupState = JSON.parse(readFileSync(setupStatePath, "utf8")); } catch { /* ignore */ }
  }

  if (setupState?.status === "interview_pending") {
    // Interview already shown — prompt-submit will handle answers
    process.stdout.write(`{"additionalContext": ${JSON.stringify(
      "[quorum setup] 아직 설정이 완료되지 않았습니다. 위 질문에 답변해주세요."
    )}}`);
    process.exit(0);
  }

  // Step 1: Scan project
  let profile;
  try {
    profile = scanProject(REPO_ROOT);
  } catch (err) {
    console.warn(`[session-start] project scan failed: ${err?.message}`);
    // Fallback to legacy first-run
    const result = firstRunSetup({ adapterRoot: pluginRoot, projectConfigDir });
    const msg = buildFirstRunMessage(result, resolve(pluginRoot, "README.md"));
    if (msg) process.stdout.write(`{"additionalContext": ${JSON.stringify(msg)}}`);
    process.exit(0);
  }

  // Step 2: Generate interview questions
  const questions = buildInterviewQuestions(profile);
  const active = getActiveQuestions(questions);

  // Step 3: Write setup state for prompt-submit to pick up
  try {
    const { mkdirSync, writeFileSync } = await import("node:fs");
    mkdirSync(projectConfigDir, { recursive: true });
    writeFileSync(setupStatePath, JSON.stringify({
      status: "interview_pending",
      profile,
      questions,
      createdAt: new Date().toISOString(),
    }, null, 2));
  } catch (err) {
    console.warn(`[session-start] setup state write failed: ${err?.message}`);
  }

  // Step 4: Output questions as additionalContext
  const scanSummary = [
    profile.languages.length > 0 ? `언어: ${profile.languages.join(", ")}` : null,
    profile.packageManager ? `패키지 매니저: ${profile.packageManager}` : null,
    profile.frameworks.length > 0 ? `프레임워크: ${profile.frameworks.join(", ")}` : null,
    profile.ci ? `CI: ${profile.ci}` : null,
    profile.testFramework ? `테스트: ${profile.testFramework}` : null,
    profile.activeDomains.length > 0 ? `도메인: ${profile.activeDomains.join(", ")}` : null,
  ].filter(Boolean).join(" | ");

  const questionText = active.map((q, i) =>
    q.type === "choice"
      ? `${i + 1}. ${q.text}\n   선택지: ${q.choices.join(", ")}`
      : `${i + 1}. ${q.text}`
  ).join("\n");

  const setupMsg = [
    "[quorum auto-setup] 프로젝트를 스캔했습니다.",
    "",
    `📋 감지 결과: ${scanSummary}`,
    "",
    "다음 질문에 답해주세요 (한 번에 답변 가능):",
    "",
    questionText,
    "",
    "답변을 자유롭게 작성해주세요. 예: \"인증 시스템 구현, 보안 중요, 혼자 작업\"",
  ].join("\n");

  process.stdout.write(`{"additionalContext": ${JSON.stringify(setupMsg)}}`);
  process.exit(0);
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

  // [FACT WB-6] Consolidate + inject established facts
  try {
    const { consolidateFacts } = await import("../../adapters/shared/fact-consolidator.mjs");
    consolidateFacts(bridge.fact ? { ...bridge.fact, db: null } : bridge._svc?.store, null);

    const established = bridge.fact?.getFacts?.({ status: "established", limit: 10 }) ?? [];
    if (established.length > 0) {
      context += `Established Facts:\n`;
      for (const f of established) {
        context += `  - [${f.category}] ${f.content}\n`;
      }
      context += `\n`;
    }
  } catch (e) { /* fact system unavailable — fail-open */ }

  // [VAULT FR-18] Reverse sync — import Obsidian edits into graph
  try {
    const { importVaultChanges } = await import("../../vault/importer.mjs");
    const { getVaultPath } = await import("../../vault/exporter.mjs");
    const vaultRoot = getVaultPath();
    const lastSync = bridge.event?.getKV?.("vault.lastSync") ?? 0;
    const importResult = importVaultChanges(bridge._svc?.store?.getDb(), vaultRoot, lastSync);
    if (importResult.created > 0 || importResult.updated > 0) {
      bridge.event?.setKV?.("vault.lastSync", Date.now());
      console.error(`[quorum] Vault sync: ${importResult.created} created, ${importResult.updated} updated`);
    }
  } catch { /* vault not configured — skip */ }

  // [DCM FR-10] Smart injection — replace static facts with dynamic recall
  try {
    const recentFiles = bridge.event?.queryEvents?.({ eventType: "tool.post", limit: 5, descending: true })
      ?.map(e => e.payload?.file).filter(Boolean) ?? [];
    const recallResults = bridge.graph?.searchKeyword?.(recentFiles.join(" "), { limit: 5 }) ?? [];
    if (recallResults.length > 0) {
      context += `\nKnowledge Graph Context:\n`;
      for (const r of recallResults) {
        context += `  ${r.type}: ${r.description || r.title}\n`;
      }
      context += `\n`;
    }
  } catch { /* graph not available — fail-open */ }

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
