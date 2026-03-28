#!/usr/bin/env node
/**
 * Gemini CLI Hook: AfterTool
 *
 * PostToolUse equivalent — quality rules, planning file sync.
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

const { triggerTag } = extractTags(cfg);
const consensus = cfg.consensus ?? {};
const log = createDebugLogger(ADAPTER_DIR);

if (process.env.FEEDBACK_LOOP_ACTIVE === "1") { log("EXIT: reentrant"); process.exit(0); }

const payload = await readStdinJson();
const toolName = String(payload?.tool_name ?? "unknown");
const filePath = String(payload?.tool_input?.file_path ?? payload?.tool_input?.path ?? "");
log(`tool=${toolName} file_path=${filePath}`);
const normalized = filePath.replace(/\\/g, "/").toLowerCase();

// Evidence via audit_submit MCP tool — no hook-side detection needed.

// ── Planning file sync ──────────────────────────────────────
if (isPlanningFile(normalized, consensus)) {
  log("MATCH: planning doc");
  process.exit(0);
}
