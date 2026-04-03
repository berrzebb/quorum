/**
 * Permission Rule Engine — deterministic pattern-based tool permission evaluation.
 *
 * Evaluates tool+content against a rule set using deny-first short-circuit.
 * Rules use a simple DSL for content matching: prefix:X, contains:X, regex:X, path:X.
 * Tool name matching supports simple glob (trailing/leading `*`).
 *
 * Core invariant: deny rules are bypass-immune — no mode can override them.
 *
 * @module bus/permission-rules
 */

// ── Types ───────────────────────────────────────────

/** Permission behavior for a rule. */
export type PermissionBehavior = "deny" | "allow" | "ask";

/** Source tier for a rule (higher = more authoritative). */
export type RuleSource = "policy" | "project" | "user" | "session" | "cli";

/** Content pattern type. */
export type ContentPatternType = "prefix" | "contains" | "regex" | "path" | "exact";

/** Parsed content pattern. */
export interface ContentPattern {
  type: ContentPatternType;
  value: string;
  /** Pre-compiled regex for 'regex' type. Null if compilation failed. */
  compiledRegex?: RegExp | null;
}

/** A single permission rule. */
export interface RuleDefinition {
  /** Tool name or glob pattern (e.g., "Bash", "mcp__quorum*"). */
  tool: string;
  /** Optional content pattern (e.g., "prefix:rm", "path:*.env"). */
  content?: string;
  /** Permission behavior. */
  behavior: PermissionBehavior;
  /** Source tier (set during loading). */
  source?: RuleSource;
  /** Human-readable description. */
  description?: string;
}

/** Reason for a permission decision. */
export interface DecisionReason {
  type: "rule" | "mode" | "classifier" | "hook" | "default" | "safe";
  rule?: RuleDefinition;
  source?: RuleSource;
  detail?: string;
}

/** Result of a permission evaluation. */
export interface PermissionDecision {
  behavior: PermissionBehavior;
  reason: DecisionReason;
}

/** Tool input context for content matching. */
export interface ToolInput {
  /** Tool name (e.g., "Bash", "Write", "mcp__quorum__code_map"). */
  tool: string;
  /** Tool input object — shape varies by tool. */
  input?: Record<string, unknown>;
}

// ── Content Pattern Parsing ─────────────────────────

/**
 * Parse a content pattern string into a structured pattern.
 *
 * Supported formats:
 * - "prefix:X"   → input starts with X
 * - "contains:X" → input includes X
 * - "regex:X"    → input matches regex X
 * - "path:X"     → file path matches glob X (simple * only)
 * - "X" (no prefix) → exact match
 */
export function parseContentPattern(pattern: string): ContentPattern {
  const colonIdx = pattern.indexOf(":");
  if (colonIdx === -1) {
    return { type: "exact", value: pattern };
  }

  const prefix = pattern.slice(0, colonIdx);
  const value = pattern.slice(colonIdx + 1);

  switch (prefix) {
    case "prefix":
      return { type: "prefix", value };
    case "contains":
      return { type: "contains", value };
    case "regex": {
      let compiledRegex: RegExp | null = null;
      try { compiledRegex = new RegExp(value); } catch { compiledRegex = null; }
      return { type: "regex", value, compiledRegex };
    }
    case "path":
      return { type: "path", value };
    default:
      // Unknown prefix — treat as exact match of the full string
      return { type: "exact", value: pattern };
  }
}

/**
 * Test a content pattern against a string value.
 */
export function matchContentPattern(pattern: ContentPattern, value: string): boolean {
  switch (pattern.type) {
    case "prefix":
      return value.startsWith(pattern.value);
    case "contains":
      return value.includes(pattern.value);
    case "regex":
      if (pattern.compiledRegex === null) return false;
      if (!pattern.compiledRegex) {
        // Lazy compile
        try { pattern.compiledRegex = new RegExp(pattern.value); } catch { pattern.compiledRegex = null; return false; }
      }
      return pattern.compiledRegex.test(value);
    case "path":
      return matchSimpleGlob(pattern.value, value);
    case "exact":
      return value === pattern.value;
  }
}

// ── Tool Name Glob Matching ─────────────────────────

/**
 * Simple glob matching — supports:
 * - "*" at end: prefix match ("mcp__quorum*" → "mcp__quorum__code_map")
 * - "*" at start: suffix match ("*_scan" → "perf_scan")
 * - No "*": exact match ("Bash" → "Bash")
 *
 * No complex glob ({a,b}, **, etc.) — tool names are simple identifiers.
 */
export function matchSimpleGlob(pattern: string, value: string): boolean {
  if (pattern === "*") return true;

  const startsWithStar = pattern.startsWith("*");
  const endsWithStar = pattern.endsWith("*");

  if (startsWithStar && endsWithStar) {
    // *foo* → contains
    const inner = pattern.slice(1, -1);
    return value.includes(inner);
  }
  if (endsWithStar) {
    // foo* → prefix
    const prefix = pattern.slice(0, -1);
    return value.startsWith(prefix);
  }
  if (startsWithStar) {
    // *foo → suffix
    const suffix = pattern.slice(1);
    return value.endsWith(suffix);
  }
  // Exact match
  return value === pattern;
}

// ── Content Extraction from Tool Input ──────────────

/**
 * Extract the relevant content string from a tool input for pattern matching.
 *
 * | Tool    | Content field         |
 * |---------|-----------------------|
 * | Bash    | tool_input.command    |
 * | Write   | tool_input.file_path  |
 * | Edit    | tool_input.file_path  |
 * | Read    | tool_input.file_path  |
 * | mcp__*  | JSON.stringify(input) |
 * | default | JSON.stringify(input) |
 */
export function extractContent(toolName: string, input?: Record<string, unknown>): string {
  if (!input) return "";

  // Bash → command
  if (toolName === "Bash" || toolName === "shell" || toolName === "run_shell_command") {
    return String(input.command ?? input.cmd ?? "");
  }

  // File-based tools → file_path
  const fileTools = new Set(["Write", "Edit", "Read", "write_file", "read_file", "edit_file", "apply_diff"]);
  if (fileTools.has(toolName)) {
    return String(input.file_path ?? input.filePath ?? input.path ?? "");
  }

  // MCP and other tools → full input JSON
  return JSON.stringify(input);
}

// ── Rules Engine ────────────────────────────────────

/**
 * Permission Rules Engine.
 *
 * Evaluates tool calls against a rule set using deny-first ordering.
 * Within the same behavior tier, rules are evaluated in registration order.
 *
 * Evaluation order: deny → ask → allow → null (no match).
 */
export class RulesEngine {
  private rules: RuleDefinition[] = [];
  private parsedPatterns = new WeakMap<RuleDefinition, ContentPattern>();

  /** Add a rule to the engine. */
  addRule(rule: RuleDefinition): void {
    this.rules.push(rule);
    // Pre-parse content pattern
    if (rule.content) {
      this.parsedPatterns.set(rule, parseContentPattern(rule.content));
    }
  }

  /** Add multiple rules at once. */
  addRules(rules: RuleDefinition[]): void {
    for (const r of rules) this.addRule(r);
  }

  /** Clear all rules. */
  clear(): void {
    this.rules = [];
    this.parsedPatterns = new WeakMap();
  }

  /** Get all rules (read-only). */
  getRules(): readonly RuleDefinition[] {
    return this.rules;
  }

  /**
   * Evaluate a tool call against the rule set.
   *
   * Returns the first matching rule's decision, or null if no rule matches.
   * Evaluation order: deny rules first, then ask, then allow.
   */
  evaluate(toolInput: ToolInput): PermissionDecision | null {
    const content = extractContent(toolInput.tool, toolInput.input);

    // Phase 1: deny rules (highest priority)
    const denyMatch = this.findMatch(toolInput.tool, content, "deny");
    if (denyMatch) {
      return {
        behavior: "deny",
        reason: { type: "rule", rule: denyMatch, source: denyMatch.source, detail: `deny rule matched: ${denyMatch.tool}` },
      };
    }

    // Phase 2: ask rules
    const askMatch = this.findMatch(toolInput.tool, content, "ask");
    if (askMatch) {
      return {
        behavior: "ask",
        reason: { type: "rule", rule: askMatch, source: askMatch.source, detail: `ask rule matched: ${askMatch.tool}` },
      };
    }

    // Phase 3: allow rules
    const allowMatch = this.findMatch(toolInput.tool, content, "allow");
    if (allowMatch) {
      return {
        behavior: "allow",
        reason: { type: "rule", rule: allowMatch, source: allowMatch.source, detail: `allow rule matched: ${allowMatch.tool}` },
      };
    }

    // No rule matched
    return null;
  }

  /**
   * Evaluate only rules with a specific behavior.
   * Useful for the gate's short-circuit steps.
   */
  evaluateBehavior(toolInput: ToolInput, behavior: PermissionBehavior): PermissionDecision | null {
    const content = extractContent(toolInput.tool, toolInput.input);
    const match = this.findMatch(toolInput.tool, content, behavior);
    if (match) {
      return {
        behavior,
        reason: { type: "rule", rule: match, source: match.source, detail: `${behavior} rule matched: ${match.tool}` },
      };
    }
    return null;
  }

  /** Find the first matching rule for a given behavior. */
  private findMatch(
    toolName: string,
    content: string,
    behavior: PermissionBehavior,
  ): RuleDefinition | null {
    for (const rule of this.rules) {
      if (rule.behavior !== behavior) continue;

      // Step 1: match tool name (exact or glob)
      if (!matchSimpleGlob(rule.tool, toolName)) continue;

      // Step 2: match content (if rule has content pattern)
      if (rule.content) {
        let pattern = this.parsedPatterns.get(rule);
        if (!pattern) {
          pattern = parseContentPattern(rule.content);
          this.parsedPatterns.set(rule, pattern);
        }
        if (!matchContentPattern(pattern, content)) continue;
      }

      // Match!
      return rule;
    }
    return null;
  }
}
