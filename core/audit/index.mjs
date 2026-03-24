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

const planningDirs = (consensus.planning_dirs ?? []).map((d) => resolve(REPO_ROOT, d));
const promotionDocPaths = planningDirs.map((d) => resolve(d, "feedback-promotion.md"));

export function initPaths(overrideWatchFile) {
  claudePath = overrideWatchFile && existsSync(overrideWatchFile) ? overrideWatchFile : findWatchFile();
}

/** Write audit-status.json marker for fast-path hook detection (no bridge needed). */
function writeAuditStatus(statusDir, status, pendingCount, rejectionCodes, track) {
  const statusPath = resolve(statusDir, "audit-status.json");
  const marker = {
    status,
    pendingCount: pendingCount ?? 0,
    rejectionCodes: rejectionCodes ?? [],
    track: track ?? "",
    timestamp: Date.now(),
  };
  try { writeFileSync(statusPath, JSON.stringify(marker, null, 2), "utf8"); } catch { /* non-critical */ }
}

/** Parse verdict text for status and rejection codes. */
function parseVerdictText(text) {
  if (!text) return { status: "unknown", pendingCount: 0, rejectionCodes: [] };

  const hasPending = /\[pending\]|\[계류\]|\[PENDING\]|\[CHANGES_REQUESTED\]/i.test(text);
  const hasApproved = /\[approved\]|\[합의완료\]|\[APPROVED\]/i.test(text);
  const hasInfraFailure = /\[INFRA_FAILURE\]/i.test(text);

  const codes = [];
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/`([\w-]+)\s*\[(major|minor|critical)\]`/);
    if (m) codes.push(`${m[1]} [${m[2]}]`);
  }

  // Count pending items
  const pendingMatches = text.match(/\[pending\]|\[계류\]/gi);
  const pendingCount = pendingMatches ? pendingMatches.length : 0;

  if (hasInfraFailure) return { status: "infra_failure", pendingCount: 0, rejectionCodes: codes };
  if (hasPending) return { status: "changes_requested", pendingCount: Math.max(1, pendingCount), rejectionCodes: codes };
  if (hasApproved) return { status: "approved", pendingCount: 0, rejectionCodes: codes };
  return { status: "unknown", pendingCount: 0, rejectionCodes: codes };
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
  const statusDir = resolve(auditCwd, ".claude");
  const auditStatusPath = resolve(statusDir, "audit-status.json");
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
    const verdictText = generateSoloVerdict(preVerified);
    const isApproved = verdictText.includes("[APPROVED]");
    const parsed = parseVerdictText(verdictText);
    // Record verdict to SQLite (single source of truth)
    try {
      bridge.recordTransition(
        "gate", "audit",
        "pending", isApproved ? "approved" : "changes_requested",
        "system",
        { mode: "solo", preVerified: true, verdictText },
      );
    } catch { /* bridge non-critical */ }
    writeAuditStatus(statusDir, parsed.status, parsed.pendingCount, parsed.rejectionCodes);
    runRespond(args);
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

  const resumeTarget = determineResumeTarget(args, auditStatusPath);
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

  const { threadId, exitCode, verdictText } = await streamCodexOutput(child, args.json);

  if (exitCode !== 0) {
    // Auto mode: fall back to solo verdict instead of infra_failure
    if (auditMode === "auto") {
      console.error("[audit] External auditor failed (exit " + exitCode + ") \u2014 falling back to solo mode");
      const fallbackText = generateSoloVerdict(preVerified);
      const isApproved = fallbackText.includes("[APPROVED]");
      const parsed = parseVerdictText(fallbackText);
      try {
        bridge.recordTransition(
          "gate", "audit",
          "pending", isApproved ? "approved" : "changes_requested",
          "system",
          { mode: "auto-fallback-solo", exitCode, verdictText: fallbackText },
        );
      } catch { /* bridge non-critical */ }
      writeAuditStatus(statusDir, parsed.status, parsed.pendingCount, parsed.rejectionCodes);
      runRespond(args);
      return;
    }

    // Record infra_failure to SQLite — worker unblocked but NOT approved
    try {
      bridge.recordTransition(
        "gate", "audit",
        "pending", "infra_failure",
        "system",
        { exitCode, mode: "infra_failure" },
      );
    } catch { /* bridge non-critical */ }
    writeAuditStatus(statusDir, "infra_failure", 0, []);
    console.error(`[audit] Codex exited with code ${exitCode} \u2014 recorded infra_failure to SQLite`);
  } else {
    // Parse verdict from captured response text
    const parsed = parseVerdictText(verdictText);
    try {
      bridge.recordTransition(
        "gate", "audit",
        "pending", parsed.status === "approved" ? "approved" : "changes_requested",
        "system",
        { mode: "external", verdictText },
      );
    } catch { /* bridge non-critical */ }
    writeAuditStatus(statusDir, parsed.status, parsed.pendingCount, parsed.rejectionCodes);
    console.log(`[audit] Verdict recorded to SQLite: ${parsed.status} (pending: ${parsed.pendingCount})`);
  }

  // Session management based on parsed verdict
  const parsed = parseVerdictText(verdictText);
  if (parsed.pendingCount === 0 && threadId) {
    deleteSavedSessionId();
    console.log(t("audit.session.reset", { tag: cfg.consensus.pending_tag }));
  } else if (threadId) {
    writeSavedSession(threadId);
    console.log(t("audit.session.saved", { id: threadId }));
  }

  runRespond(args);
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
