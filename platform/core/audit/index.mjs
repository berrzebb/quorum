#!/usr/bin/env node
/* global process, console */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import * as bridge from "../bridge.mjs";
import {
  HOOKS_DIR, REPO_ROOT, cfg, plugin, consensus, safeLocale,
  t, resolvePluginPath, resolveReferencesDir, escapeRe, pendingInner, agreeInner,
} from "../context.mjs";

import { parseArgs } from "./args.mjs";
import { initSessionDir, writeSavedSession, deleteSavedSessionId } from "./session.mjs";
import { hasPendingItems, detectScope, checkEslintCoverage, loadPromotionHint, buildPromotionSection } from "./scope.mjs";
import { runPreVerification, computeChangedFiles } from "./pre-verify.mjs";
import { resolveCodexBin, determineResumeTarget, buildCodexArgs, streamCodexOutput } from "./codex-runner.mjs";
import { generateSoloVerdict } from "./solo-verdict.mjs";
import { spawnResolvedAsync } from "../cli-runner.mjs";

const promptTemplatePath = resolvePluginPath(plugin.audit_prompt);

const planningDirs = (consensus.planning_dirs ?? []).map((d) => resolve(REPO_ROOT, d));
const promotionDocPaths = planningDirs.map((d) => resolve(d, "feedback-promotion.md"));

// Verdict tag matchers — dynamic patterns compiled once (config-derived)
const PENDING_RE = new RegExp(`\\[(?:pending|PENDING|CHANGES_REQUESTED|${escapeRe(pendingInner)})\\]`, "gi");
const APPROVED_RE = new RegExp(`\\[(?:approved|APPROVED|${escapeRe(agreeInner)})\\]`, "gi");
const INFRA_FAILURE_RE = /\[INFRA_FAILURE\]/i;

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

  const hasInfraFailure = INFRA_FAILURE_RE.test(text);

  const codes = [];
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/`([\w-]+)\s*\[(major|minor|critical)\]`/);
    if (m) codes.push(`${m[1]} [${m[2]}]`);
  }

  const pendingMatches = text.match(PENDING_RE);
  const pendingCount = pendingMatches ? pendingMatches.length : 0;

  if (hasInfraFailure) return { status: "infra_failure", pendingCount: 0, rejectionCodes: codes };
  if (pendingCount > 0) return { status: "changes_requested", pendingCount, rejectionCodes: codes };
  APPROVED_RE.lastIndex = 0; // .test() with /g advances lastIndex — must reset
  if (APPROVED_RE.test(text)) return { status: "approved", pendingCount: 0, rejectionCodes: codes };
  return { status: "unknown", pendingCount: 0, rejectionCodes: codes };
}

export function runRespond(args) {
  if (!args.sync && !args.pickNext && !args.autoFix) {
    return;
  }

  const respondArgs = [resolve(HOOKS_DIR, "respond.mjs")];
  if (args.autoFix) {
    respondArgs.push("--auto-fix");
  }
  const respondCwd = REPO_ROOT;
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

/** Derive worktree root from a path. If path is inside a worktree, return that root. */
export function deriveAuditCwd(path) {
  if (!path) return REPO_ROOT;
  const worktreeMatch = path.replace(/\\/g, "/").match(/(.+\/.claude\/worktrees\/[^/]+)\//);
  if (worktreeMatch) return worktreeMatch[1];
  return REPO_ROOT;
}

function buildPrompt(scopeText, promotionHint, preVerified, diffScope, contextAnchor) {
  const template = readFileSync(promptTemplatePath, "utf8");
  const promotionSection = buildPromotionSection(promotionHint);
  return template
    .split("{{CONTEXT_ANCHOR}}").join(contextAnchor ?? "")
    .split("{{SCOPE}}").join(scopeText)
    .split("{{PRE_VERIFIED}}").join(preVerified)
    .split("{{DIFF_CMD}}").join(diffScope ?? "")
    .split("{{PROMOTION_SECTION}}").join(promotionSection)
    .split("{{TRIGGER_TAG}}").join(cfg.consensus.trigger_tag)
    .split("{{AGREE_TAG}}").join(cfg.consensus.agree_tag)
    .split("{{PENDING_TAG}}").join(cfg.consensus.pending_tag)
    .split("{{DESIGN_DOCS_DIR}}").join(cfg.consensus.design_docs_dir ?? "docs/plan/*/design/**")
    .split("{{LOCALE}}").join(safeLocale)
    .split("{{REFERENCES_DIR}}").join(
      resolveReferencesDir(safeLocale).replace(/\\/g, "/"),
    );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  // Initialize bridge (loads EventStore from SQLite)
  await bridge.init(REPO_ROOT);

  // Audit CWD — always REPO_ROOT (worktree context comes from ProcessMux, not file paths)
  const auditCwd = REPO_ROOT;
  const statusDir = resolve(auditCwd, ".claude");
  const auditStatusPath = resolve(statusDir, "audit-status.json");
  // Session files go to the worktree too (prevents cross-worktree state corruption)
  if (auditCwd !== REPO_ROOT) initSessionDir(resolve(auditCwd, ".claude"));

  if (args.resetSession) {
    deleteSavedSessionId();
  }

  // Read evidence from SQLite (single source of truth)
  let claudeMd;
  try {
    const evidence = bridge.getLatestEvidence();
    if (evidence?.content) {
      claudeMd = evidence.content;
    }
  } catch { /* bridge non-critical */ }

  if (!claudeMd) {
    throw new Error("No evidence found in EventStore. Submit evidence via audit_submit tool first.");
  }

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
    const parsed = parseVerdictText(verdictText);
    // Record verdict to SQLite (single source of truth)
    try {
      bridge.recordTransition(
        "gate", "audit",
        "pending", parsed.status === "approved" ? "approved" : "changes_requested",
        "system",
        { mode: "solo", preVerified: true, verdictText },
      );
    } catch { /* bridge non-critical */ }
    writeAuditStatus(statusDir, parsed.status, parsed.pendingCount, parsed.rejectionCodes);
    runRespond(args);
    return;
  }

  let prompt = buildPrompt(scopeText, promotionHint, preVerified, diffScope);

  // Append evidence content to prompt so the auditor can verify claims
  if (claudeMd) {
    prompt += "\n\n# Implementer Evidence Package\n" + claudeMd + "\n";
  }

  // Guard: truncate prompt if too large — prevents Codex STATUS_HEAP_CORRUPTION crash
  const MAX_PROMPT_CHARS = 80_000;
  if (prompt.length > MAX_PROMPT_CHARS) {
    console.error(`[audit] Prompt too large (${prompt.length} chars) \u2014 truncating to ${MAX_PROMPT_CHARS}`);
    // Keep the audit protocol header + truncated evidence
    const header = prompt.slice(0, 20_000);
    const tail = prompt.slice(-10_000);
    prompt = header + "\n\n\u26A0\uFE0F TRUNCATED: evidence was too large. Review evidence via EventStore for full content.\n\n" + tail;
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

  let parsed;
  if (exitCode !== 0) {
    // Auto mode: fall back to solo verdict instead of infra_failure
    if (auditMode === "auto") {
      console.error("[audit] External auditor failed (exit " + exitCode + ") \u2014 falling back to solo mode");
      const fallbackText = generateSoloVerdict(preVerified);
      parsed = parseVerdictText(fallbackText);
      try {
        bridge.recordTransition(
          "gate", "audit",
          "pending", parsed.status === "approved" ? "approved" : "changes_requested",
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
    parsed = parseVerdictText(verdictText);
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

  // Session management — infra_failure preserves session for retry
  if (exitCode !== 0 && threadId) {
    writeSavedSession(threadId);
    console.log(t("audit.session.saved", { id: threadId }));
  } else if (parsed?.pendingCount === 0 && threadId) {
    deleteSavedSessionId();
    console.log(t("audit.session.reset", { tag: cfg.consensus.pending_tag }));
  } else if (threadId) {
    writeSavedSession(threadId);
    console.log(t("audit.session.saved", { id: threadId }));
  }

  runRespond(args);
}

main()
  .catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`feedback-audit failed: ${message}`);
    process.exitCode = 1;
  });
