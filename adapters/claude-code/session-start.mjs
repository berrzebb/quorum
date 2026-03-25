#!/usr/bin/env node
/**
 * Hook: SessionStart
 * Loads handoff + recent changes + audit state as context for new sessions.
 * Detects interrupted audit cycles and orchestrator tracks → provides resume instructions.
 */
import { readFileSync, existsSync, cpSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { syncHandoffFromMemory } from "./handoff-writer.mjs";
import { readAuditStatus, readRetroMarker, AUDIT_STATUS } from "../../adapters/shared/audit-state.mjs";
import { resolveRepoRoot } from "../../adapters/shared/repo-resolver.mjs";
import { createT } from "../../core/context.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolveRepoRoot({ adapterDir: __dirname });

const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT ?? __dirname;
const configPath = (() => {
  const pr = process.env.CLAUDE_PLUGIN_ROOT;
  if (pr) {
    const p = resolve(pr, "config.json");
    if (existsSync(p)) return p;
  }
  const local = resolve(__dirname, "config.json");
  return existsSync(local) ? local : null;
})();

// ── config.json not found → auto-copy to project dir + prompt to customize ──
if (!configPath) {
  const projectConfigDir = resolve(REPO_ROOT, ".claude", "quorum");
  const exampleConfig = resolve(pluginRoot, "examples", "config.example.json");
  const configDest = resolve(projectConfigDir, "config.json");
  const exampleTemplates = resolve(pluginRoot, "examples", "templates");
  const templatesDest = resolve(projectConfigDir, "templates");

  const autoCopied = [];

  // config.json → project directory (survives plugin updates)
  if (existsSync(exampleConfig)) {
    try {
      mkdirSync(projectConfigDir, { recursive: true });
      cpSync(exampleConfig, configDest);
      autoCopied.push("config.json");
    } catch { /* write permission error */ }
  }

  // templates/ → project directory (policy files persist across updates)
  if (!existsSync(templatesDest) && existsSync(exampleTemplates)) {
    try {
      cpSync(exampleTemplates, templatesDest, { recursive: true });
      autoCopied.push("templates/");
    } catch { /* write permission error */ }
  }

  if (autoCopied.length > 0) {
    const guide = [
      `[quorum — First-Run Setup Complete]`,
      ``,
      `Auto-copied: ${autoCopied.join(", ")}`,
      `Location: ${projectConfigDir}`,
      `(Project-scoped — safe across plugin updates)`,
      ``,
      `Customize for your project:`,
      `- config.json → consensus.trigger_tag/agree_tag/pending_tag, quality_rules`,
      `- templates/references/{locale}/ → audit policies (rejection codes, test criteria, evidence format)`,
      ``,
      `Full guide: ${resolve(pluginRoot, "README.md")}`,
    ].join("\n");
    const escaped = JSON.stringify(guide);
    process.stdout.write(`{"additionalContext": ${escaped}}`);
    process.exit(0);
  }

  // examples/ directory missing (broken install) — manual guidance
  const guide = [
    `[SETUP REQUIRED — quorum]`,
    ``,
    `config.json not found and examples/ directory is missing.`,
    `Reinstall the plugin: claude plugin add berrzebb/quorum`,
    `Or manually create config.json. See: https://github.com/berrzebb/quorum`,
  ].join("\n");
  const escaped = JSON.stringify(guide);
  process.stdout.write(`{"additionalContext": ${escaped}}`);
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
} catch { /* non-fatal */ }

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
} catch { /* git unavailable */ }

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
  } catch { /* snapshot parse error */ }
}

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
// Dynamically reads the "Absolute Rules" section from AI-GUIDE.md (Policy as Data).
const locale = cfg.plugin?.locale ?? "en";
const guideDir = (() => {
  const pr = process.env.CLAUDE_PLUGIN_ROOT ?? __dirname;
  const p = resolve(pr, "docs", locale, "AI-GUIDE.md");
  if (existsSync(p)) return p;
  // fallback: try the other locale
  const fb = locale === "ko" ? "en" : "ko";
  const p2 = resolve(pr, "docs", fb, "AI-GUIDE.md");
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
  } catch { /* AI-GUIDE read error — non-fatal */ }
}

// ── Output ──────────────────────────────────────────────────
if (context) {
  const escaped = JSON.stringify(context);
  process.stdout.write(`{"additionalContext": ${escaped}}`);
}
