#!/usr/bin/env node
/**
 * Gemini CLI Hook: AfterTool
 *
 * PostToolUse equivalent — detects watch_file edits, validates evidence,
 * evaluates trigger, runs audit. Core audit pipeline for Gemini.
 *
 * Uses shared modules for business logic, Gemini-specific I/O here.
 */
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { spawn } from "node:child_process";

import { createHookContext, createDebugLogger, readStdinJson } from "../../../shared/hook-io.mjs";
import { extractTags } from "../../../shared/config-resolver.mjs";
import {
  validateEvidenceFormat,
  parseChangedFiles,
  buildTriggerContext,
  hasPlanDocuments,
  isPlanningFile,
} from "../../../shared/trigger-runner.mjs";

const { ADAPTER_DIR, REPO_ROOT, cfg, configMissing } = createHookContext(import.meta.url);
if (configMissing) process.exit(0);

const { watchFile, triggerTag } = extractTags(cfg);
const consensus = cfg.consensus ?? {};
const log = createDebugLogger(ADAPTER_DIR);

if (process.env.FEEDBACK_LOOP_ACTIVE === "1") { log("EXIT: reentrant"); process.exit(0); }

const payload = await readStdinJson();
const toolName = String(payload?.tool_name ?? "unknown");
const filePath = String(payload?.tool_input?.file_path ?? payload?.tool_input?.path ?? "");
log(`tool=${toolName} file_path=${filePath}`);
const normalized = filePath.replace(/\\/g, "/").toLowerCase();

// ── Detect watch_file edit ──────────────────────────────────
if (normalized.endsWith(watchFile.toLowerCase())) {
  const watchPath = existsSync(filePath) ? filePath : resolve(REPO_ROOT, watchFile);
  if (!existsSync(watchPath)) { log("EXIT: watch_file not found"); process.exit(0); }

  const content = readFileSync(watchPath, "utf8");
  if (!content.includes(triggerTag)) { log("EXIT: no trigger_tag"); process.exit(0); }

  // Pre-validate evidence format
  const { errors, warnings } = validateEvidenceFormat(content, consensus);
  if (errors.length > 0) {
    const errorList = errors.map((e) => `  • ${e}`).join("\n");
    // Gemini protocol: JSON on stdout, diagnostics on stderr
    process.stderr.write(`[quorum] 증거 형식 불완전:\n${errorList}\n`);
    process.stdout.write(JSON.stringify({
      decision: "deny",
      reason: `증거 형식 불완전: ${errors[0]}`,
    }));
    log(`FORMAT_INCOMPLETE: ${errors.length} errors`);
    process.exit(2);
  }

  if (warnings.length > 0) {
    const warnList = warnings.map((w) => `  ⚠ ${w}`).join("\n");
    process.stderr.write(`[quorum] 간이 감사 경고 (${warnings.length}건):\n${warnList}\n`);
  }

  // ── Bridge: evaluate trigger ──
  let bridge;
  try {
    bridge = await import("../../../../core/bridge.mjs");
    await bridge.init(REPO_ROOT);
    // Initialize HookRunner from config + HOOK.md
    await bridge.initHookRunner(REPO_ROOT, cfg.hooks);
  } catch (err) {
    log(`BRIDGE_INIT_FAIL: ${err.message}`);
    bridge = null;
  }

  if (bridge) {
    // Fire pre-audit hooks — user can deny to block audit
    const preGate = await bridge.checkHookGate("audit.submit", {
      cwd: REPO_ROOT, metadata: { provider: "gemini", watchFile: watchPath },
    });
    if (!preGate.allowed) {
      log(`HOOK_DENY: audit.submit blocked — ${preGate.reason}`);
      console.log(`[quorum] Audit blocked by hook: ${preGate.reason}`);
      bridge.close();
      process.exit(0);
    }
    const changedFiles = parseChangedFiles(content);
    const changedFileCount = changedFiles.length;

    // Run domain detection + blast radius in parallel
    const [detectionResult, blastResult] = await Promise.all([
      bridge.detectDomains(changedFiles, content).catch(() => null),
      changedFiles.length > 0
        ? bridge.computeBlastRadius(changedFiles).catch(() => null)
        : null,
    ]);
    const blastRadius = blastResult?.ratio;
    const priorRejections = (bridge.queryEvents?.({ eventType: "audit.verdict" }) ?? [])
      .filter((e) => e.payload?.verdict === "changes_requested").length;
    const hasPlanDoc = hasPlanDocuments(REPO_ROOT);

    const triggerCtx = buildTriggerContext({
      content,
      changedFiles,
      changedFileCount,
      detectionResult,
      priorRejections,
      hasPlanDoc,
      blastRadius,
    });

    const triggerResult = bridge.evaluateTrigger(triggerCtx);
    if (triggerResult) {
      log(`TRIGGER: mode=${triggerResult.mode} tier=${triggerResult.tier} score=${triggerResult.score.toFixed(2)}`);
      bridge.emitEvent("audit.submit", "gemini", {
        file: watchPath,
        tier: triggerResult.tier,
        mode: triggerResult.mode,
        score: triggerResult.score,
        reasons: triggerResult.reasons,
      });

      // Parliament session: T3 deliberative + parliament.enabled → diverge-converge protocol
      if (triggerResult.mode === "deliberative" && cfg.parliament?.enabled) {
        log("PARLIAMENT: T3 deliberative with parliament protocol enabled");
        try {
          const sessionResult = await bridge.runParliamentSession(
            { prompt: content, evidence: watchPath },
            {
              agendaId: cfg.parliament?.defaultAgenda ?? "research-questions",
              sessionType: new Date().getHours() < 12 ? "morning" : "afternoon",
              consensus: consensus.roles ?? {},
              eligibleVoters: cfg.parliament?.eligibleVoters ?? 3,
              implementerTestimony: cfg.parliament?.testimony,
              confluenceInput: { auditVerdict: undefined },
            },
          );
          if (sessionResult?.verdict?.finalVerdict) {
            log(`PARLIAMENT: verdict=${sessionResult.verdict.finalVerdict} converged=${sessionResult.convergence?.converged ?? false}`);
            bridge.emitEvent("audit.verdict", "gemini", {
              verdict: sessionResult.verdict.finalVerdict,
              summary: sessionResult.verdict.judgeSummary,
              codes: sessionResult.verdict.opinions?.flatMap(o => o.codes) ?? [],
              mode: "parliament",
            });
          }
        } catch (err) {
          log(`PARLIAMENT_ERROR: ${err.message}`);
        }
      }

      const minTier = cfg.experiment?.minimum_tier ?? 0;
      if (triggerResult.mode === "skip" && minTier < 2) {
        log("SKIP: T1 micro change");
        process.stdout.write(JSON.stringify({
          hookSpecificOutput: {
            additionalContext: `[quorum] T1 micro change (score: ${triggerResult.score.toFixed(2)}) — audit skipped.`,
          },
        }));
        bridge.close();
        process.exit(0);
      }
    }

    // Pre-spawn hook gate BEFORE close (close nulls _hookRunner)
    const spawnGate = await bridge.checkHookGate("audit.spawn", {
      cwd: REPO_ROOT, metadata: { provider: "gemini", watchFile: watchPath },
    });
    bridge.close();
    if (!spawnGate.allowed) {
      log(`HOOK_DENY: audit.spawn blocked — ${spawnGate.reason}`);
      process.exit(0);
    }
  }

  // ── Spawn audit process ──
  const auditScript = resolve(REPO_ROOT, "core", "audit.mjs");
  const quorumRoot = resolve(ADAPTER_DIR, "..", "..");
  const auditFallback = resolve(quorumRoot, "core", "audit.mjs");
  const scriptToRun = existsSync(auditScript) ? auditScript : existsSync(auditFallback) ? auditFallback : null;

  if (scriptToRun) {
    log(`AUDIT_START: ${scriptToRun}`);
    try {
      const logDir = resolve(REPO_ROOT, ".claude");
      if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });
      const child = spawn(process.execPath, [scriptToRun, "--watch-file", watchPath], {
        cwd: REPO_ROOT,
        detached: true,
        stdio: "ignore",
        env: { ...process.env, FEEDBACK_LOOP_ACTIVE: "1" },
        windowsHide: true,
      });
      child.unref();
      // Gemini protocol: JSON on stdout
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
          additionalContext: `[quorum] 감사 시작 (PID ${child.pid}) — ${triggerTag} 증거가 제출되었습니다.`,
        },
      }));
    } catch (err) {
      log(`SPAWN_ERROR: ${err.message}`);
      process.stderr.write("[quorum] 감사 프로세스 시작 실패\n");
    }
  } else {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        additionalContext: `[quorum] ${triggerTag} 증거가 제출되었습니다. 수동 감사: quorum audit`,
      },
    }));
  }
  process.exit(0);
}

// ── Planning file sync ──────────────────────────────────────
if (isPlanningFile(normalized, consensus)) {
  log("MATCH: planning doc");
  process.exit(0);
}
