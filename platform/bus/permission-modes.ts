/**
 * Permission Modes — 6 operational modes for tool approval gating.
 *
 * Core invariant: deny rules are bypass-immune across ALL modes.
 * No mode can override a deny rule.
 *
 * @module bus/permission-modes
 */

import type { PermissionDecision } from "./permission-rules.js";

// ── Types ───────────────────────────────────────────

/**
 * 6 permission modes (aligned with Claude Code).
 *
 * - default:     Full evaluation (rules → classifier → policy chain)
 * - plan:        Read-only auto-allow, write goes through rules
 * - auto:        Safe allowlist + deny rules only. CI/automation mode.
 * - bypass:      Nearly all tools auto-allow. DENY RULES STILL BLOCK (bypass-immune).
 * - dontAsk:     ask → allow automatically. deny preserved.
 * - acceptEdits: Write/Edit auto-allow, rest standard.
 */
export type PermissionMode =
  | "default"
  | "plan"
  | "auto"
  | "bypass"
  | "dontAsk"
  | "acceptEdits";

/** Decision from mode evaluation. */
export type ModeDecision = "allow" | "ask" | null;

/** Context for mode evaluation. */
export interface ModeEvalContext {
  /** Tool name. */
  tool: string;
  /** Whether the tool is in the safe allowlist. */
  isSafe: boolean;
  /** Whether the tool is read-only (from capability). */
  isReadOnly: boolean;
  /** Whether the tool is a write/edit tool. */
  isWriteTool: boolean;
  /** Result from RulesEngine (if any rule matched). */
  rulesResult: PermissionDecision | null;
}

// ── Read-Only Tool Set ──────────────────────────────

const READ_ONLY_TOOLS = new Set([
  "Read", "Glob", "Grep", "ToolSearch",
  // Codex equivalents
  "read_file", "find_files", "search",
  // Gemini equivalents
  "read_file",
]);

const WRITE_TOOLS = new Set([
  "Write", "Edit",
  // Codex
  "write_file", "apply_diff",
  // Gemini
  "edit_file", "write_file",
]);

/** Check if a tool name is read-only. */
export function isReadOnlyTool(tool: string): boolean {
  return READ_ONLY_TOOLS.has(tool);
}

/** Check if a tool name is a write/edit tool. */
export function isWriteEditTool(tool: string): boolean {
  return WRITE_TOOLS.has(tool);
}

// ── Mode Evaluator ──────────────────────────────────

/**
 * Evaluate a tool call through mode-specific logic.
 *
 * IMPORTANT: This function is called AFTER deny/ask rules have been checked.
 * If a deny rule matched, the gate short-circuits before reaching this function.
 * Therefore, this function never needs to check for deny rules.
 *
 * Returns:
 * - "allow" → tool is approved by mode logic
 * - "ask" → tool needs further evaluation (classifier/policy chain)
 * - null → mode has no opinion, continue to next step
 */
export function evaluateMode(mode: PermissionMode, ctx: ModeEvalContext): ModeDecision {
  switch (mode) {
    case "default":
      return evaluateDefault(ctx);
    case "plan":
      return evaluatePlan(ctx);
    case "auto":
      return evaluateAuto(ctx);
    case "bypass":
      return evaluateBypass(ctx);
    case "dontAsk":
      return evaluateDontAsk(ctx);
    case "acceptEdits":
      return evaluateAcceptEdits(ctx);
  }
}

// ── Mode Implementations ────────────────────────────

/** default: no special behavior — continue to standard evaluation. */
function evaluateDefault(_ctx: ModeEvalContext): ModeDecision {
  return null; // No opinion — proceed to policy chain / classifier
}

/** plan: read-only tools auto-allow, everything else → ask. */
function evaluatePlan(ctx: ModeEvalContext): ModeDecision {
  if (ctx.isReadOnly || isReadOnlyTool(ctx.tool)) return "allow";
  if (ctx.isSafe) return "allow";
  return null; // Write tools go through standard evaluation
}

/** auto: safe tools allowed, everything else allowed (deny rules already checked). */
function evaluateAuto(ctx: ModeEvalContext): ModeDecision {
  // In auto mode, if we got past deny rules, allow everything
  // (deny rules are checked before this function is called)
  return "allow";
}

/** bypass: allow everything. Deny rules are bypass-immune (checked before this). */
function evaluateBypass(_ctx: ModeEvalContext): ModeDecision {
  // If we reached here, no deny rule matched → allow
  return "allow";
}

/** dontAsk: ask → allow automatically. */
function evaluateDontAsk(ctx: ModeEvalContext): ModeDecision {
  // If rules said "ask", convert to "allow"
  if (ctx.rulesResult?.behavior === "ask") return "allow";
  // Otherwise, allow if safe
  if (ctx.isSafe) return "allow";
  // For non-safe tools, still allow (dontAsk = suppress all prompts)
  return "allow";
}

/** acceptEdits: Write/Edit auto-allow, rest standard. */
function evaluateAcceptEdits(ctx: ModeEvalContext): ModeDecision {
  if (ctx.isWriteTool || isWriteEditTool(ctx.tool)) return "allow";
  return null; // Non-write tools go through standard evaluation
}

// ── Mode State ──────────────────────────────────────

/** Module-scoped mode state (session lifetime). */
let currentMode: PermissionMode = "default";

/** Set the current permission mode. */
export function setMode(mode: PermissionMode): void {
  currentMode = mode;
}

/** Get the current permission mode. */
export function getMode(): PermissionMode {
  return currentMode;
}

/** Reset to default mode (for testing). */
export function resetMode(): void {
  currentMode = "default";
}
