#!/usr/bin/env node
/**
 * Codex CLI Hook: AfterToolUse (v0.100.0+)
 *
 * Fires after individual tool execution. Core audit pipeline for Codex.
 * Detects watch_file edits → validates evidence → triggers audit.
 *
 * Uses shared modules — same business logic as Claude Code PostToolUse
 * and Gemini AfterTool.
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
} from "../../../shared/trigger-runner.mjs";

const { ADAPTER_DIR, REPO_ROOT, cfg, configMissing } = createHookContext(import.meta.url);
if (configMissing) process.exit(0);

const { watchFile, triggerTag } = extractTags(cfg);
const consensus = cfg.consensus ?? {};
const log = createDebugLogger(ADAPTER_DIR);

if (process.env.FEEDBACK_LOOP_ACTIVE === "1") { log("EXIT: reentrant"); process.exit(0); }

const input = await readStdinJson();

const toolName = String(input?.tool_name ?? "unknown");
const filePath = String(input?.tool_input?.file_path ?? input?.tool_input?.path ?? "");
log(`tool=${toolName} file_path=${filePath}`);
const normalized = filePath.replace(/\\/g, "/").toLowerCase();

// ── Detect watch_file edit ──────────────────────────────────
if (normalized.endsWith(watchFile.toLowerCase())) {
  const watchPath = existsSync(filePath) ? filePath : resolve(REPO_ROOT, watchFile);
  if (!existsSync(watchPath)) { log("EXIT: watch_file not found"); process.exit(0); }

  const content = readFileSync(watchPath, "utf8");
  if (!content.includes(triggerTag)) { log("EXIT: no trigger_tag"); process.exit(0); }

  const { errors, warnings } = validateEvidenceFormat(content, consensus);
  if (errors.length > 0) {
    process.stderr.write(`[quorum] Evidence incomplete: ${errors[0]}\n`);
    log(`FORMAT_INCOMPLETE: ${errors.length} errors`);
    process.exit(0);
  }

  if (warnings.length > 0) {
    process.stderr.write(`[quorum] Warnings: ${warnings.length}\n`);
  }

  // ── Bridge: evaluate trigger ──
  let bridge;
  try {
    bridge = await import("../../../../core/bridge.mjs");
    await bridge.init(REPO_ROOT);
    await bridge.initHookRunner(REPO_ROOT, cfg.hooks);
  } catch (err) {
    log(`BRIDGE_INIT_FAIL: ${err.message}`);
    bridge = null;
  }

  if (bridge) {
    const preGate = await bridge.checkHookGate("audit.submit", {
      cwd: REPO_ROOT, metadata: { provider: "codex", watchFile: watchPath },
    });
    if (!preGate.allowed) {
      log(`HOOK_DENY: ${preGate.reason}`);
      process.stderr.write(`[quorum] Audit blocked: ${preGate.reason}\n`);
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
      content, changedFiles, changedFileCount, detectionResult, priorRejections, hasPlanDoc, blastRadius,
    });

    const triggerResult = bridge.evaluateTrigger(triggerCtx);
    if (triggerResult) {
      log(`TRIGGER: mode=${triggerResult.mode} tier=${triggerResult.tier} score=${triggerResult.score.toFixed(2)}`);
      bridge.emitEvent("audit.submit", "codex", {
        file: watchPath, tier: triggerResult.tier, mode: triggerResult.mode, score: triggerResult.score,
      });

      if (triggerResult.mode === "skip") {
        log("SKIP: T1 micro change");
        process.stdout.write(`[quorum] T1 skip (score: ${triggerResult.score.toFixed(2)})\n`);
        bridge.close();
        process.exit(0);
      }
    }

    const spawnGate = await bridge.checkHookGate("audit.spawn", {
      cwd: REPO_ROOT, metadata: { provider: "codex", watchFile: watchPath },
    });
    bridge.close();
    if (!spawnGate.allowed) {
      log(`HOOK_DENY: audit.spawn blocked — ${spawnGate.reason}`);
      process.exit(0);
    }
  }

  // ── Spawn audit ──
  const quorumRoot = resolve(ADAPTER_DIR, "..", "..");
  const auditScript = resolve(quorumRoot, "core", "audit.mjs");
  if (existsSync(auditScript)) {
    log(`AUDIT_START: ${auditScript}`);
    try {
      const logDir = resolve(REPO_ROOT, ".claude");
      if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });
      const child = spawn(process.execPath, [auditScript, "--watch-file", watchPath], {
        cwd: REPO_ROOT, detached: true, stdio: "ignore",
        env: { ...process.env, FEEDBACK_LOOP_ACTIVE: "1" },
        windowsHide: true,
      });
      child.unref();
      process.stdout.write(`[quorum] Audit started (PID ${child.pid})\n`);
    } catch (err) {
      log(`SPAWN_ERROR: ${err.message}`);
    }
  } else {
    process.stdout.write(`[quorum] ${triggerTag} evidence submitted. Manual: quorum audit\n`);
  }
}
