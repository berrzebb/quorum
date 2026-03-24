#!/usr/bin/env node
/**
 * Gemini CLI Hook: BeforeTool
 *
 * Session-gate: blocks Bash/Agent tools when retro is pending.
 * Equivalent to Claude Code's PreToolUse (session-gate.mjs).
 *
 * Gemini hooks receive input via stdin (JSON) and output to stdout.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { readRetroMarker } from "../../../shared/audit-state.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ADAPTER_DIR = resolve(__dirname, "..");
const MARKER_DIR = resolve(ADAPTER_DIR, ".session-state");
const COMPLETION_CMD = "session-self-improvement-complete";
const ALLOWED_TOOLS = ["read_file", "write_file", "edit_file", "glob", "grep", "todo_write"];

// Quick check: retro marker
const marker = readRetroMarker(ADAPTER_DIR);
if (!marker || !marker.retro_pending) {
  process.exit(0);
}

// Read stdin
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const raw = Buffer.concat(chunks).toString("utf8").trim();
if (!raw) process.exit(0);

let input;
try { input = JSON.parse(raw); } catch { process.exit(0); }

const toolName = input.tool_name || "";

// Completion command → release marker
if (toolName === "shell") {
  const command = (input.tool_input?.command || "").trim();
  if (command === COMPLETION_CMD ||
      command === `echo ${COMPLETION_CMD}` ||
      /^echo\s+["']?session-self-improvement-complete["']?\s*$/.test(command)) {
    const markerPath = resolve(MARKER_DIR, "retro-marker.json");
    if (!existsSync(MARKER_DIR)) mkdirSync(MARKER_DIR, { recursive: true });
    writeFileSync(markerPath, JSON.stringify({
      retro_pending: false,
      completed_at: new Date().toISOString(),
    }, null, 2), "utf8");
    process.exit(0);
  }
}

// Allowed tools → pass through
if (ALLOWED_TOOLS.includes(toolName)) {
  process.exit(0);
}

// Block other tools
console.error(`[quorum] 회고 미완료 — ${toolName} 차단됨. echo session-self-improvement-complete 으로 해제`);
process.exit(2);
