/**
 * Safe Tool Registry — allowlist of tools that skip classifier evaluation.
 *
 * Safe tools bypass the classifier for performance, but deny rules
 * STILL apply to safe tools. "Safe" means "skip classifier", not "always allow".
 *
 * @module bus/safe-tools
 */

import { matchSimpleGlob, parseContentPattern, matchContentPattern, extractContent } from "./permission-rules.js";

// ── Types ───────────────────────────────────────────

/** A safe tool entry — tool name with optional content constraint. */
export interface SafeToolEntry {
  /** Tool name or glob pattern. */
  tool: string;
  /** Optional content constraint (e.g., "prefix:ls" for Bash). */
  content?: string;
}

// ── Default Safe Tools ──────────────────────────────

/** Default safe tools — read-only tools + safe Bash subcommands. */
export const DEFAULT_SAFE_TOOLS: readonly SafeToolEntry[] = [
  { tool: "Read" },
  { tool: "Glob" },
  { tool: "Grep" },
  { tool: "ToolSearch" },
  // Codex equivalents
  { tool: "read_file" },
  { tool: "find_files" },
  { tool: "search" },
  // Bash safe subcommands
  { tool: "Bash", content: "prefix:ls" },
  { tool: "Bash", content: "prefix:cat" },
  { tool: "Bash", content: "prefix:echo" },
  { tool: "Bash", content: "prefix:git status" },
  { tool: "Bash", content: "prefix:git log" },
  { tool: "Bash", content: "prefix:git diff" },
];

// ── Safe Tool Registry ──────────────────────────────

/**
 * Registry for safe tools that skip classifier evaluation.
 *
 * Safe tools are evaluated in order. A tool is "safe" if it matches
 * any entry (tool name + optional content pattern).
 */
export class SafeToolRegistry {
  private entries: SafeToolEntry[];

  constructor(customEntries?: SafeToolEntry[]) {
    this.entries = customEntries
      ? [...customEntries]
      : [...DEFAULT_SAFE_TOOLS];
  }

  /**
   * Check if a tool call is safe (should skip classifier).
   *
   * Matches against the registry entries. If an entry has a content
   * constraint, the tool input is checked against it.
   */
  isSafe(tool: string, input?: Record<string, unknown>): boolean {
    for (const entry of this.entries) {
      // Match tool name (exact or glob)
      if (!matchSimpleGlob(entry.tool, tool)) continue;

      // If no content constraint, tool name match is sufficient
      if (!entry.content) return true;

      // Check content constraint
      const content = extractContent(tool, input);
      const pattern = parseContentPattern(entry.content);
      if (matchContentPattern(pattern, content)) return true;
    }

    return false;
  }

  /** Add a safe tool entry. */
  addSafe(entry: SafeToolEntry): void {
    this.entries.push(entry);
  }

  /** Remove a safe tool entry by tool name. */
  removeSafe(tool: string): void {
    this.entries = this.entries.filter(e => e.tool !== tool);
  }

  /** Get all registered safe tool entries. */
  getAll(): readonly SafeToolEntry[] {
    return this.entries;
  }

  /** Load additional entries from config. */
  loadFromConfig(safeTools: string[]): void {
    for (const spec of safeTools) {
      // Parse "Tool(content)" format: "Bash(prefix:ls)"
      const match = spec.match(/^(\w+)\((.+)\)$/);
      if (match) {
        this.entries.push({ tool: match[1]!, content: match[2]! });
      } else {
        this.entries.push({ tool: spec });
      }
    }
  }
}
