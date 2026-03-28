#!/usr/bin/env node
/**
 * Gemini CLI Hook: BeforeTool
 *
 * Session-gate: blocks Bash/Agent tools when retro is pending.
 * Equivalent to Claude Code's PreToolUse (session-gate.mjs).
 *
 * Gemini hooks receive input via stdin (JSON) and output to stdout.
 */
import { writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

import { readRetroMarker } from "../../../shared/audit-state.mjs";
import { readStdinJson } from "../../../shared/hook-io.mjs";

const __dirname = (await import("node:path")).dirname((await import("node:url")).fileURLToPath(import.meta.url));
const ADAPTER_DIR = resolve(__dirname, "..");
const MARKER_DIR = resolve(ADAPTER_DIR, ".session-state");
const COMPLETION_CMD = "session-self-improvement-complete";
// Gemini CLI tool names — run_shell_command (not "shell")
const ALLOWED_TOOLS = ["read_file", "write_file", "edit_file", "glob", "grep", "todo_write"];

// Quick check: retro marker
const marker = readRetroMarker(ADAPTER_DIR);
if (!marker || !marker.retro_pending) {
  process.exit(0);
}

const input = await readStdinJson();
const toolName = input.tool_name || "";

// Completion command → release marker
if (toolName === "run_shell_command" || toolName === "shell") {
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

// Block other tools — Gemini protocol: JSON on stdout + exit 2
const reason = `[quorum] Retro incomplete — ${toolName} blocked. Run: echo session-self-improvement-complete`;
process.stdout.write(JSON.stringify({ decision: "deny", reason }));
process.exit(2);
