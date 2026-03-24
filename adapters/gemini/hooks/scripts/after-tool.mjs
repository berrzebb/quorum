#!/usr/bin/env node
/**
 * Gemini CLI Hook: AfterTool
 *
 * PostToolUse equivalent — detects watch_file edits, validates evidence,
 * evaluates trigger, runs audit. Core audit pipeline for Gemini.
 *
 * Uses shared modules for business logic, Gemini-specific I/O here.
 */
import { readFileSync, existsSync, appendFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

import { resolveRepoRoot } from "../../../shared/repo-resolver.mjs";
import { loadConfig, extractTags } from "../../../shared/config-resolver.mjs";
import {
  validateEvidenceFormat,
  parseChangedFiles,
  countChangedFiles,
  buildTriggerContext,
  hasPlanDocuments,
  isPlanningFile,
} from "../../../shared/trigger-runner.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ADAPTER_DIR = resolve(__dirname, "..");
const REPO_ROOT = resolveRepoRoot({ adapterDir: __dirname });
const { cfg, configMissing } = loadConfig({ repoRoot: REPO_ROOT, adapterDir: ADAPTER_DIR });

if (configMissing) process.exit(0);

const { watchFile, triggerTag, agreeTag, pendingTag } = extractTags(cfg);
const consensus = cfg.consensus ?? {};

const debugLog = resolve(ADAPTER_DIR, "debug.log");
function log(msg) {
  const ts = new Date().toISOString().replace("T", " ").slice(0, 19);
  try { appendFileSync(debugLog, `[${ts}] ${msg}\n`); } catch { /* */ }
}

// Prevent reentrant invocation
if (process.env.FEEDBACK_LOOP_ACTIVE === "1") { log("EXIT: reentrant"); process.exit(0); }

// Read stdin (Gemini hook payload)
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const raw = Buffer.concat(chunks).toString("utf8").trim();
if (!raw) { log("EXIT: empty stdin"); process.exit(0); }

let payload;
try { payload = JSON.parse(raw); } catch { log("EXIT: JSON parse error"); process.exit(0); }

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
    console.log(`[quorum] 증거 형식 불완전:\n${errorList}`);
    log(`FORMAT_INCOMPLETE: ${errors.length} errors`);
    process.exit(0);
  }

  if (warnings.length > 0) {
    const warnList = warnings.map((w) => `  ⚠ ${w}`).join("\n");
    console.log(`[quorum] 간이 감사 경고 (${warnings.length}건):\n${warnList}`);
  }

  // ── Bridge: evaluate trigger ──
  let bridge;
  try {
    bridge = await import("../../../../core/bridge.mjs");
    await bridge.init(REPO_ROOT);
  } catch (err) {
    log(`BRIDGE_INIT_FAIL: ${err.message}`);
    bridge = null;
  }

  if (bridge) {
    const changedFiles = parseChangedFiles(content);
    const changedFileCount = countChangedFiles(content);

    const detectionResult = await bridge.detectDomains(changedFiles, content).catch(() => null);
    const priorRejections = (bridge.queryEvents?.({ eventType: "audit.verdict" }) ?? [])
      .filter((e) => e.payload?.verdict === "changes_requested").length;
    const hasPlanDoc = hasPlanDocuments(REPO_ROOT);

    let blastRadius;
    if (changedFiles.length > 0) {
      try {
        const br = await bridge.computeBlastRadius(changedFiles);
        if (br?.ratio !== undefined) blastRadius = br.ratio;
      } catch { /* non-critical */ }
    }

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

      const minTier = cfg.experiment?.minimum_tier ?? 0;
      if (triggerResult.mode === "skip" && minTier < 2) {
        log("SKIP: T1 micro change");
        console.log(`[quorum] T1 micro change (score: ${triggerResult.score.toFixed(2)}) — audit skipped.`);
        bridge.close();
        process.exit(0);
      }
    }
    bridge.close();
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
      console.log(`[quorum] 감사 시작 (PID ${child.pid}) — ${triggerTag} 증거가 제출되었습니다.`);
    } catch (err) {
      log(`SPAWN_ERROR: ${err.message}`);
      console.log("[quorum] 감사 프로세스 시작 실패");
    }
  } else {
    console.log(`[quorum] ${triggerTag} 증거가 제출되었습니다. 수동 감사: quorum audit`);
  }
  process.exit(0);
}

// ── Planning file sync ──────────────────────────────────────
if (isPlanningFile(normalized, consensus)) {
  log("MATCH: planning doc");
  process.exit(0);
}
