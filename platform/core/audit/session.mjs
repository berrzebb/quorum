import { existsSync, readFileSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import * as bridge from "../bridge.mjs";
import { plugin, resolvePluginPath } from "../context.mjs";

let _sessionDir = null;

export function initSessionDir(dir) {
  _sessionDir = dir;
}

export function getSessionPath() {
  return _sessionDir
    ? resolve(_sessionDir, plugin.session_file)
    : resolvePluginPath(plugin.session_file);
}

// Derive worktree-specific KV key for session isolation
export function sessionKVKey() {
  if (_sessionDir) {
    // Extract worktree name from path like ".claude/worktrees/agent-1/.claude"
    const match = _sessionDir.replace(/\\/g, "/").match(/worktrees\/([^/]+)/);
    if (match) return `session:${match[1]}`;
  }
  return "session:main";
}

export function readSavedSession() {
  // Try SQLite KV first (worktree-isolated)
  try {
    const kv = bridge.query.getState(sessionKVKey());
    if (kv && typeof kv === "object" && kv.id) return kv.id;
    if (typeof kv === "string" && kv) return kv;
  } catch (err) { console.warn("[session] KV read failed:", err?.message ?? err); }

  // Fallback: JSON file
  const sp = getSessionPath();
  if (!existsSync(sp)) return null;
  try {
    const stored = JSON.parse(readFileSync(sp, "utf8"));
    if (!stored.id) return null;
    return stored.id;
  } catch (err) {
    console.warn("[session] session file parse failed:", err?.message ?? err);
    return null;
  }
}

export function writeSavedSession(sessionId) {
  // Write to SQLite KV (primary, worktree-isolated)
  try {
    bridge.query.setState(sessionKVKey(), { id: sessionId });
  } catch (err) { console.warn("[session] KV write failed:", err?.message ?? err); }

  // Also write to JSON file (backward compatibility)
  const sp = getSessionPath();
  mkdirSync(dirname(sp), { recursive: true });
  writeFileSync(sp, JSON.stringify({ id: sessionId }) + "\n", "utf8");
}

export function deleteSavedSessionId() {
  // Delete from SQLite KV
  try {
    bridge.query.setState(sessionKVKey(), null);
  } catch (err) { console.warn("[session] KV delete failed:", err?.message ?? err); }

  // Also delete JSON file
  const sp = getSessionPath();
  if (existsSync(sp)) rmSync(sp, { force: true });
}
