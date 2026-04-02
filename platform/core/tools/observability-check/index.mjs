/**
 * observability-check/index.mjs — Tool: observability_check
 *
 * Check for observability gaps: empty catch blocks, missing error logging,
 * console.log in production code, missing metrics/tracing.
 * Extracted from tool-core.mjs (SPLIT-2).
 */
import { runPatternScan, _gatherDomainPatterns, _langRegistry } from "../tool-utils.mjs";

// ═══ Observability patterns ═════════════════════════════════════════════

const OBS_PATTERNS = [
  { re: /catch\s*\(\s*\w*\s*\)\s*\{\s*\}/m, label: "empty-catch", severity: "high", msg: "Empty catch block — error silently swallowed" },
  { re: /catch\s*\{[\s\n]*\}/m, label: "empty-catch", severity: "high", msg: "Empty catch block — error silently swallowed" },
  { re: /catch\s*\(\s*\w+\s*\)\s*\{[\s\n]*\/\//m, label: "comment-only-catch", severity: "medium", msg: "Catch block with only comments — no error handling" },
  { re: /console\.(log|info|debug)\s*\(/m, label: "console-log", severity: "low", msg: "console.log in source — use structured logger" },
  { re: /catch\s*\([^)]*\)\s*\{[^}]*console\.error/m, label: "console-error-only", severity: "medium", msg: "catch uses console.error — no structured error reporting" },
  { re: /process\.exit\s*\(\s*[^0)]/m, label: "hard-exit", severity: "medium", msg: "process.exit with error code — may skip cleanup" },
  { re: /throw\s+new\s+Error\s*\(\s*\)/m, label: "empty-error", severity: "medium", msg: "throw new Error() with no message" }, // scan-ignore: msg contains pattern text, triggers self-referential match
];

// ═══ Tool: observability_check ══════════════════════════════════════════

/**
 * Check for observability gaps: empty catch blocks, missing error logging,
 * console.log in production code, missing metrics/tracing.
 */
export function toolObservabilityCheck(params) {
  return runPatternScan({
    targetPath: params.path,
    extensions: _langRegistry?.extensionsForDomain("observability") ?? new Set([".ts", ".tsx", ".js", ".jsx", ".mjs"]),
    patterns: _gatherDomainPatterns("observability", OBS_PATTERNS),
    toolName: "observability_check",
    heading: "Observability Check Results",
    passMsg: "no observability gaps detected",
    failNoun: "observability gap(s)",
  });
}
