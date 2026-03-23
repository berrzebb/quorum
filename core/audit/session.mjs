import { existsSync, readFileSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import * as bridge from "../bridge.mjs";
import { HOOKS_DIR, plugin } from "../context.mjs";

let _sessionDir = null;

export function initSessionDir(dir) {
  _sessionDir = dir;
}

export function getSessionPath() {
  return _sessionDir
    ? resolve(_sessionDir, plugin.session_file)
    : resolve(HOOKS_DIR, plugin.session_file);
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
    const kv = bridge.getState(sessionKVKey());
    if (kv && typeof kv === "object" && kv.id) return kv.id;
    if (typeof kv === "string" && kv) return kv;
  } catch { /* fall through */ }

  // Fallback: JSON file
  const sp = getSessionPath();
  if (!existsSync(sp)) return null;
  try {
    const stored = JSON.parse(readFileSync(sp, "utf8"));
    if (!stored.id) return null;
    return stored.id;
  } catch {
    return null;
  }
}

export function writeSavedSession(sessionId) {
  // Write to SQLite KV (primary, worktree-isolated)
  try {
    bridge.setState(sessionKVKey(), { id: sessionId });
  } catch { /* fall through */ }

  // Also write to JSON file (backward compatibility)
  const sp = getSessionPath();
  mkdirSync(dirname(sp), { recursive: true });
  writeFileSync(sp, JSON.stringify({ id: sessionId }) + "\n", "utf8");
}

export function deleteSavedSessionId() {
  // Delete from SQLite KV
  try {
    bridge.setState(sessionKVKey(), null);
  } catch { /* fall through */ }

  // Also delete JSON file
  const sp = getSessionPath();
  if (existsSync(sp)) rmSync(sp, { force: true });
}
