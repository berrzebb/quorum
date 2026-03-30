#!/usr/bin/env node
/**
 * Codex CLI Hook: AfterToolUse (v0.100.0+)
 *
 * Fires after individual tool execution. Core audit pipeline for Codex.
 * Evidence submission via audit_submit MCP tool.
 *
 * Uses shared modules — same business logic as Claude Code PostToolUse
 * and Gemini AfterTool.
 */
import { createHookContext, createDebugLogger, readStdinJson } from "../../../shared/hook-io.mjs";

const { ADAPTER_DIR, cfg, configMissing } = createHookContext(import.meta.url);
if (configMissing) process.exit(0);

const log = createDebugLogger(ADAPTER_DIR);

if (process.env.FEEDBACK_LOOP_ACTIVE === "1") { log("EXIT: reentrant"); process.exit(0); }

const input = await readStdinJson();

const toolName = String(input?.tool_name ?? "unknown");
const filePath = String(input?.tool_input?.file_path ?? input?.tool_input?.path ?? "");
log(`tool=${toolName} file_path=${filePath}`);
const normalized = filePath.replace(/\\/g, "/").toLowerCase();

// Evidence via audit_submit MCP tool — no hook-side detection needed.
