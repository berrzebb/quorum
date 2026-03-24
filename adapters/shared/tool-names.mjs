/**
 * Adapter-specific tool name mapping.
 *
 * Different AI runtimes use different names for the same operations.
 * This table enables shared logic to work across adapters.
 */

/** @type {Record<string, Record<string, string>>} */
export const TOOL_MAP = {
  "claude-code": {
    bash: "Bash",
    read: "Read",
    write: "Write",
    edit: "Edit",
    glob: "Glob",
    grep: "Grep",
    agent: "Agent",
    todoWrite: "TodoWrite",
  },
  gemini: {
    bash: "run_shell_command",
    read: "read_file",
    write: "write_file",
    edit: "edit_file",
    glob: "glob",
    grep: "grep",
    agent: "spawn_agent",
    todoWrite: "todo_write",
  },
  codex: {
    bash: "shell",
    read: "read_file",
    write: "write_file",
    edit: "apply_diff",
    glob: "find_files",
    grep: "search",
    agent: "create_agent",
    todoWrite: "todo",
  },
};

/**
 * Get the native tool name for a given adapter and canonical operation.
 *
 * @param {string} adapter — adapter name ("claude-code", "gemini", "codex")
 * @param {string} canonical — canonical tool name ("bash", "read", "write", etc.)
 * @returns {string} Native tool name for that adapter
 */
export function getToolName(adapter, canonical) {
  return TOOL_MAP[adapter]?.[canonical] ?? canonical;
}

/**
 * Reverse lookup: find the canonical operation for a native tool name.
 *
 * @param {string} adapter — adapter name
 * @param {string} nativeName — native tool name (e.g. "Write", "write_file")
 * @returns {string|null} Canonical name or null if not found
 */
export function getCanonicalName(adapter, nativeName) {
  const map = TOOL_MAP[adapter];
  if (!map) return null;
  for (const [canonical, native] of Object.entries(map)) {
    if (native === nativeName) return canonical;
  }
  return null;
}

/**
 * Check if a native tool name represents a file-editing operation.
 *
 * @param {string} adapter — adapter name
 * @param {string} nativeName — native tool name
 * @returns {boolean}
 */
export function isFileEditTool(adapter, nativeName) {
  const canonical = getCanonicalName(adapter, nativeName);
  return canonical === "write" || canonical === "edit";
}
