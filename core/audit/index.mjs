#!/usr/bin/env node
/* global process, console */

import { readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import * as bridge from "../bridge.mjs";
import {
  HOOKS_DIR, REPO_ROOT, cfg, plugin, consensus, safeLocale,
  t, findWatchFile, resolvePluginPath,
} from "../context.mjs";

import { parseArgs } from "./args.mjs";
import { initSessionDir, writeSavedSession, deleteSavedSessionId } from "./session.mjs";
import { hasPendingItems, detectScope, checkEslintCoverage, loadPromotionHint, buildPromotionSection } from "./scope.mjs";
import { runPreVerification, computeChangedFiles } from "./pre-verify.mjs";
import { resolveCodexBin, determineResumeTarget, buildCodexArgs, streamCodexOutput } from "./codex-runner.mjs";
import { generateSoloVerdict } from "./solo-verdict.mjs";
import { spawnResolvedAsync } from "../cli-runner.mjs";

const promptTemplatePath = resolvePluginPath(plugin.audit_prompt);

// Lazy-initialized in main() — avoid dirname(null) crash at module load time.
let claudePath = null;
let gptPath    = null;

const planningDirs = (consensus.planning_dirs ?? []).map((d) => resolve(REPO_ROOT, d));
const promotionDocPaths = planningDirs.map((d) => resolve(d, "feedback-promotion.md"));

/** Append audit-completed timestamp to gpt.md (idempotent). */
export function stampAuditCompleted(path) {
  if (!existsSync(path)) return;
  let content = readFileSync(path, "utf8");
  const ts = new Date().toISOString().replace("T", " ").slice(0, 16);
  const tsLabel = t("index.timestamp.label");
  const tsLine = `\n---\n> ${tsLabel}: ${ts}\n`;
  if (content.includes(`${tsLabel}: ${ts}`)) return;
  // Remove any previous timestamp line, then append new one
  content = content.replace(/\n---\n> [^:]+: \d{4}-\d{2}-\d{2} \d{2}:\d{2}\n/g, "");
  content = content.trimEnd() + tsLine;
  writeFileSync(path, content, "utf8");
}

export function initPaths(overrideWatchFile) {
  claudePath = overrideWatchFile && existsSync(overrideWatchFile) ? overrideWatchFile : findWatchFile();
  gptPath = claudePath ? resolve(dirname(claudePath), plugin.respond_file ?? "gpt.md") : null;
}

export function runRespond(args) {
  if (!args.sync && !args.pickNext && !args.autoFix) {
    return;
  }

  const respondArgs = [resolve(HOOKS_DIR, "respond.mjs")];
  if (args.watchFile) {
    respondArgs.push("--watch-file", args.watchFile);
  }
  if (args.autoFix) {
    respondArgs.push("--auto-fix");
  }
  if (!args.pickNext) {
    respondArgs.push("--no-sync-next");
  }

  const respondCwd = args.watchFile ? deriveAuditCwd(args.watchFile) : REPO_ROOT;
  const result = spawnSync(process.execPath, respondArgs, {
    cwd: respondCwd,
    stdio: "inherit",
    encoding: "utf8",
    windowsHide: true,
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    // Do NOT process.exit() — it bypasses .finally() lock cleanup
    console.error(`[audit] respond.mjs exited with code ${result.status}`);
    process.exitCode = result.status ?? 1;
  }
}

/** Derive worktree root from watch_file path. If watch_file is inside a worktree, return that root. */
export function deriveAuditCwd(watchFile) {
  if (!watchFile) return REPO_ROOT;
  // Pattern: .../.claude/worktrees/<agent>/docs/feedback/claude.md
  const worktreeMatch = watchFile.replace(/\\/g, "/").match(/(.+\/.claude\/worktrees\/[^/]+)\//);
  if (worktreeMatch) return worktreeMatch[1];
  return REPO_ROOT;
}

function buildPrompt(scopeText, promotionHint, preVerified, diffScope) {
  const template = readFileSync(promptTemplatePath, "utf8");
  const promotionSection = buildPromotionSection(promotionHint);
  return template
    .split("{{SCOPE}}").join(scopeText)
    .split("{{PRE_VERIFIED}}").join(preVerified)
    .split("{{DIFF_CMD}}").join(diffScope ?? "")
    .split("{{PROMOTION_SECTION}}").join(promotionSection)
    .split("{{CLAUDE_MD_PATH}}").join(claudePath)
    .split("{{GPT_MD_PATH}}").join(gptPath)
    .split("{{TRIGGER_TAG}}").join(cfg.consensus.trigger_tag)
    .split("{{AGREE_TAG}}").join(cfg.consensus.agree_tag)
    .split("{{PENDING_TAG}}").join(cfg.consensus.pending_tag)
    .split("{{DESIGN_DOCS_DIR}}").join(cfg.consensus.design_docs_dir ?? "docs/ko/design/**")
    .split("{{LOCALE}}").join(safeLocale)
    .split("{{REFERENCES_DIR}}").join(
      resolve(HOOKS_DIR, "templates", "references", safeLocale).replace(/\\/g, "/"),
    );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  initPaths(args.watchFile);

  // Resolve audit CWD: if watch_file is in a worktree, Codex must run there
  const auditCwd = deriveAuditCwd(args.watchFile);
  // Session files go to the worktree too (prevents cross-worktree state corruption)
  if (auditCwd !== REPO_ROOT) initSessionDir(resolve(auditCwd, ".claude"));

  if (args.resetSession) {
    deleteSavedSessionId();
  }

  if (!claudePath || !existsSync(claudePath)) {
    throw new Error(`Missing watch file: ${claudePath ?? consensus.watch_file}`);
  }

  const claudeMd = readFileSync(claudePath, "utf8");

  // Pre-check: eslint scope consistency before audit
  const eslintWarnings = checkEslintCoverage(claudeMd);
  if (eslintWarnings.length > 0) {
    console.warn(t("audit.eslint.mismatch_header"));
    for (const { heading, missing } of eslintWarnings) {
      console.warn(t("audit.eslint.heading", { heading }));
      for (const f of missing) {
        console.warn(t("audit.eslint.missing", { file: f }));
      }
    }
    console.warn("");
  }

  if (!args.scope && !hasPendingItems(claudeMd)) {
    console.log(t("audit.no_pending", { trigger: cfg.consensus.trigger_tag, pending: cfg.consensus.pending_tag }));
    runRespond(args);
    return;
  }

  const scopeText = args.scope ?? detectScope(claudeMd);
  const preVerified = runPreVerification(claudeMd, auditCwd);
  const promotionHint = loadPromotionHint(promotionDocPaths);
  const diffScope = computeChangedFiles(claudeMd, auditCwd);
  // Solo audit mode: skip external model, use pre-verification results only
  const auditMode = cfg.consensus?.audit_mode || "external";
  if (auditMode === "solo") {
    console.log("[audit] Solo mode \u2014 generating verdict from pre-verification only");
    const verdict = generateSoloVerdict(preVerified);
    writeFileSync(gptPath, verdict, "utf8");
    // Dual-write: record verdict transition to SQLite
    try {
      const isApproved = verdict.includes("[APPROVED]");
      bridge.recordTransition(
        "gate", "audit",
        "pending", isApproved ? "approved" : "changes_requested",
        "system",
        { mode: "solo", preVerified: true },
      );
    } catch { /* bridge non-critical */ }
    runRespond(args);
    stampAuditCompleted(gptPath);
    return;
  }

  let prompt = buildPrompt(scopeText, promotionHint, preVerified, diffScope);

  // Guard: truncate prompt if too large — prevents Codex STATUS_HEAP_CORRUPTION crash
  const MAX_PROMPT_CHARS = 80_000;
  if (prompt.length > MAX_PROMPT_CHARS) {
    console.error(`[audit] Prompt too large (${prompt.length} chars) \u2014 truncating to ${MAX_PROMPT_CHARS}`);
    // Keep the audit protocol header + truncated evidence
    const header = prompt.slice(0, 20_000);
    const tail = prompt.slice(-10_000);
    prompt = header + "\n\n\u26A0\uFE0F TRUNCATED: evidence was too large. Review the watch_file directly for full content.\n\n" + tail;
  }

  const codexBin = resolveCodexBin();

  if (args.dryRun) {
    if (args.debugBin) {
      console.log(t("audit.debug_bin", { bin: codexBin }));
    }
    console.log(prompt);
    return;
  }

  const resumeTarget = determineResumeTarget(args, gptPath);
  if (resumeTarget?.type === "session") {
    console.log(t("audit.session.resuming", { id: resumeTarget.value }));
  } else if (resumeTarget?.type === "last") {
    console.log(t("audit.session.resuming_last"));
  } else {
    console.log(t("audit.session.starting"));
  }

  const codexArgs = buildCodexArgs(args, resumeTarget, auditCwd);
  if (args.debugBin) {
    console.log(t("audit.debug_bin", { bin: codexBin }));
  }

  const child = spawnResolvedAsync(codexBin, codexArgs, {
    cwd: auditCwd,
    stdio: ["pipe", "pipe", "pipe"],
  });

  // 프롬프트를 stdin으로 전달 후 닫기
  child.stdin.write(prompt);
  child.stdin.end();

  const { threadId, exitCode } = await streamCodexOutput(child, args.json);

  if (exitCode !== 0) {
    // Auto mode: fall back to solo verdict instead of infra_failure
    if (auditMode === "auto") {
      console.error("[audit] External auditor failed (exit " + exitCode + ") \u2014 falling back to solo mode");
      const verdict = generateSoloVerdict(preVerified);
      writeFileSync(gptPath, verdict, "utf8");
      // Dual-write: record fallback verdict to SQLite
      try {
        const isApproved = verdict.includes("[APPROVED]");
        bridge.recordTransition(
          "gate", "audit",
          "pending", isApproved ? "approved" : "changes_requested",
          "system",
          { mode: "auto-fallback-solo", exitCode },
        );
      } catch { /* bridge non-critical */ }
      runRespond(args);
      stampAuditCompleted(gptPath);
      return;
    }

    // Do NOT call process.exit() here — it skips .finally() lock cleanup.
    // Instead, write an infra_failure verdict so the worker can proceed.
    const failureVerdict = [
      `## [INFRA_FAILURE]`,
      ``,
      `### Audit Scope`,
      ``,
      `infra_failure: auditor exited with code ${exitCode}. No external review performed.`,
      ``,
      `### Final Verdict`,
      ``,
      `- Status: infra_failure (auditor unreachable)`,
      `- Action: worker unblocked \u2014 NOT approved. Requires manual review or retry.`,
      ``,
      `### Execution Metadata`,
      ``,
      `| Field | Value |`,
      `|-------|-------|`,
      `| execution_mode | degraded_infra_failure |`,
      `| audit_status | unreachable |`,
      `| merge_status | provisional |`,
      `| baseline_eligible | false |`,
      ``,
    ].join("\n");
    writeFileSync(gptPath, failureVerdict, "utf8");
    // Dual-write: record infra failure to SQLite
    try {
      bridge.recordTransition(
        "gate", "audit",
        "pending", "infra_failure",
        "system",
        { exitCode, mode: "infra_failure" },
      );
    } catch { /* bridge non-critical */ }
    console.error(`[audit] Codex exited with code ${exitCode} \u2014 wrote infra_failure verdict to ${gptPath}`);
  }

  if (existsSync(gptPath)) {
    console.log(t("audit.updated", { path: gptPath }));
    const gptMd = readFileSync(gptPath, "utf8");
    if (!hasPendingItems(gptMd) && threadId) {
      deleteSavedSessionId();
      console.log(t("audit.session.reset", { tag: cfg.consensus.pending_tag }));
    } else if (threadId) {
      writeSavedSession(threadId);
      console.log(t("audit.session.saved", { id: threadId }));
    }
  } else if (threadId) {
    writeSavedSession(threadId);
    console.log(t("audit.session.saved", { id: threadId }));
  }

  runRespond(args);
  stampAuditCompleted(gptPath);
}

// Lock is per-worktree: if --watch-file is in a worktree, lock goes there too.
const watchFileArg = process.argv.find((a, i) => process.argv[i - 1] === "--watch-file");
const auditLockRoot = watchFileArg ? deriveAuditCwd(watchFileArg) : REPO_ROOT;
const auditLockPath = resolve(auditLockRoot, ".claude", "audit.lock");
main()
  .catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`feedback-audit failed: ${message}`);
    process.exitCode = 1;
  })
  .finally(() => {
    // 정상/에러 모두 락 해제 — 다음 감사가 시작될 수 있도록
    try { rmSync(auditLockPath, { force: true }); } catch { /* ignore */ }
  });
