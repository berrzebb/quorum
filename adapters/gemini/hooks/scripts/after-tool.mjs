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
import { evaluateAuditTrigger } from "../../../shared/audit-trigger.mjs";
import { validateEvidenceFormat, isPlanningFile } from "../../../shared/trigger-runner.mjs";

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
    process.stderr.write(`[quorum] Evidence format incomplete:\n${errorList}\n`);
    process.stdout.write(JSON.stringify({
      decision: "deny",
      reason: `Evidence format incomplete: ${errors[0]}`,
    }));
    log(`FORMAT_INCOMPLETE: ${errors.length} errors`);
    process.exit(2);
  }

  if (warnings.length > 0) {
    const warnList = warnings.map((w) => `  ⚠ ${w}`).join("\n");
    process.stderr.write(`[quorum] Quick audit warnings (${warnings.length}):\n${warnList}\n`);
  }

  // ── Bridge: evaluate trigger ──
  const { triggerResult, spawnAllowed, denyReason } = await evaluateAuditTrigger({
    repoRoot: REPO_ROOT, cfg, content, watchPath, source: "gemini", log,
  });

  if (denyReason) {
    console.log(`[quorum] Audit blocked by hook: ${denyReason}`);
    process.exit(0);
  }

  const minTier = cfg.experiment?.minimum_tier ?? 0;
  if (triggerResult?.mode === "skip" && minTier < 2) {
    log("SKIP: T1 micro change");
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        additionalContext: `[quorum] T1 micro change (score: ${triggerResult.score.toFixed(2)}) — audit skipped.`,
      },
    }));
    process.exit(0);
  }

  if (!spawnAllowed) process.exit(0);

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
          additionalContext: `[quorum] Audit started (PID ${child.pid}) — ${triggerTag} evidence submitted.`,
        },
      }));
    } catch (err) {
      log(`SPAWN_ERROR: ${err.message}`);
      process.stderr.write("[quorum] Audit process spawn failed\n");
    }
  } else {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        additionalContext: `[quorum] ${triggerTag} evidence submitted. Manual audit: quorum audit`,
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
