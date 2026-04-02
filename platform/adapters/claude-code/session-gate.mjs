#!/usr/bin/env node
/* global process, Buffer */

/**
 * PreToolUse hook: session self-improvement protocol gate.
 *
 * 1. Check marker file first — exit immediately without reading stdin if not retro_pending (minimal overhead)
 * 2. Only parse stdin when retro_pending → per-tool allow/block decision
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MARKER_DIR = resolve(__dirname, ".session-state");
const MARKER_PATH = resolve(MARKER_DIR, "retro-marker.json");
const COMPLETION_CMD = "session-self-improvement-complete";
const ALLOWED_TOOLS = ["Read", "Write", "Edit", "Glob", "Grep", "TodoWrite"];

const KV_MARKER_KEY = "retro:marker";

// Lazy bridge import — only loaded when needed (avoid overhead on non-retro path)
let _bridge = null;
async function getBridge() {
  if (_bridge) return _bridge;
  try {
    _bridge = await import("../../core/bridge.mjs");
    return _bridge;
  } catch (err) {
    console.warn(`[session-gate] bridge import failed: ${err?.message}`);
    return null;
  }
}

function read_marker() {
  // Try SQLite KV first (atomic, no file race)
  try {
    if (_bridge) {
      const kv = _bridge.query.getState(KV_MARKER_KEY);
      if (kv !== null) return kv;
    }
  } catch (err) { console.warn(`[session-gate] KV read failed, falling through to file: ${err?.message}`); }

  // Fallback: JSON file
  try {
    return JSON.parse(readFileSync(MARKER_PATH, "utf8"));
  } catch (err) {
    console.warn(`[session-gate] marker file read failed: ${err?.message}`);
    return null;
  }
}

function write_marker(data) {
  // Write to SQLite KV (primary)
  try {
    if (_bridge) {
      _bridge.query.setState(KV_MARKER_KEY, data);
    }
  } catch (err) { console.warn(`[session-gate] KV write failed, falling through to file: ${err?.message}`); }

  // Always write to JSON file too (backward compatibility + fallback)
  if (!existsSync(MARKER_DIR)) mkdirSync(MARKER_DIR, { recursive: true });
  writeFileSync(MARKER_PATH, JSON.stringify(data, null, 2), "utf8");
}

// Quick check: file marker first (no bridge overhead on normal path)
const fileMarker = read_marker();
if (!fileMarker || !fileMarker.retro_pending) {
  process.exit(0);
}

// retro_pending detected — now init bridge for SQLite-backed state
try {
  const b = await getBridge();
  if (b) await b.init(process.cwd());
} catch (err) { console.warn(`[session-gate] bridge init failed: ${err?.message}`); }

// Re-read marker with bridge available (SQLite may have more recent state)
const marker = read_marker();
if (!marker || !marker.retro_pending) {
  process.exit(0);
}

// Hook toggle — only checked when retro is pending (no overhead on normal path)
try {
  const cfgPath = (() => {
    const pr = process.env.CLAUDE_PLUGIN_ROOT;
    if (pr) { const p = resolve(pr, "config.json"); if (existsSync(p)) return p; }
    return resolve(__dirname, "config.json");
  })();
  const c = JSON.parse(readFileSync(cfgPath, "utf8"));
  if (c.plugin?.hooks_enabled?.session_gate === false) process.exit(0);
} catch (err) { console.warn(`[session-gate] config read error — default: enabled: ${err?.message}`); }

// Load i18n only when retro is pending (avoid overhead on every tool call)
const { t } = await import("../../core/context.mjs");

// Only read stdin when retro_pending
let raw;
try {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  raw = Buffer.concat(chunks).toString("utf8").trim();
} catch (err) {
  // stdin read error (e.g. closed unexpectedly) — fail open
  console.warn(`[session-gate] stdin read error: ${err?.message}`);
  process.exit(0);
}
if (!raw) { process.exit(0); }

let input;
try { input = JSON.parse(raw); } catch (err) { console.warn(`[session-gate] JSON parse error: ${err?.message}`); process.exit(0); }

// Session isolation: pass through if marker's session_id differs from current
const current_session = input.session_id || "";
if (marker.session_id && current_session && marker.session_id !== current_session) {
  process.exit(0);
}

// Subagent pass-through: forked contexts (implementer, planner, etc.) are allowed
// They are doing implementation work, not committing — gate only blocks the main session
const is_subagent = input.parent_tool_use_id != null;
if (is_subagent) {
  process.exit(0);
}

const tool_name = input.tool_name || "";

// Completion command → release marker
if (tool_name === "Bash") {
  const command = input.tool_input?.command || "";
  const cmdTrimmed = command.trim();
  if (cmdTrimmed === COMPLETION_CMD ||
      cmdTrimmed === `echo ${COMPLETION_CMD}` ||
      /^echo\s+["']?session-self-improvement-complete["']?\s*$/.test(cmdTrimmed)) {
    write_marker({
      retro_pending: false,
      completed_at: new Date().toISOString(),
    });
    process.exit(0);
  }
}

// Memory-related tools → allow
if (ALLOWED_TOOLS.includes(tool_name)) {
  if (!marker.instructions_shown) {
    write_marker({ ...marker, instructions_shown: true });
    const context = marker.agreed_items || t("retro.no_agreed_items");
    let output = t("gate.protocol", { context });

    // Structural enforcement: inject policy review requirement into retrospective
    if (marker.policy_review_needed && marker.policy_review_needed.length > 0) {
      output += `\n\n⚠️ **[ENFORCEMENT] Policy Review Required**\n`;
      output += `The following rejection codes have >30% false positive rate and need policy file review:\n`;
      for (const code of marker.policy_review_needed) {
        output += `- \`${code}\` → check \`templates/references/{locale}/rejection-codes.md\` and \`test-checklist.md\`\n`;
      }
      output += `\nThis is a structural enforcement, not a suggestion. Address before completing retrospective.\n`;
    }

    process.stdout.write(output);
  }
  process.exit(0);
}

// Bash/Agent etc. → block
process.stdout.write(t("gate.blocked", { tool: tool_name }));
process.exit(2);
