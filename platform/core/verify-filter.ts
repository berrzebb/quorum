/**
 * Verify command security filter — shared across governance gates and evaluators.
 *
 * Three-layer defense for WB verify command execution:
 *   1. Allowlist prefix check (only trusted CLI tools)
 *   2. Shell metacharacter filter (blocks injection via ;&|`$><%)
 *   3. Interpreter inline execution filter (blocks -e/-c/-p/--eval/--command/--print)
 */

/** Allowed verifier command prefixes. */
export const ALLOWED_VERIFY_PREFIXES = [
  "npm ", "npx ", "node ", "tsc ", "eslint ", "vitest ",
  "go ", "cargo ", "python ", "pytest ", "pip ",
  "java ", "javac ", "mvn ", "gradle ",
];

/** Shell metacharacters that enable command chaining/injection (incl. Windows %VAR% expansion). */
export const VERIFY_SHELL_META = /[;&|`$><\r\n%]/;

/** Interpreter inline execution patterns (space or = delimited). -p/--print is also inline eval. */
export const VERIFY_INTERPRETER_RE = /\s-[ecp]\s|\s-[ecp]$|\s--eval[\s=]|\s--command[\s=]|\s--print[\s=]/;

/**
 * Check if a verifier command is allowed.
 * Three-layer defense: allowlist prefix + metachar filter + interpreter inline filter.
 */
export function isAllowedVerifier(cmd: string): boolean {
  const trimmed = cmd.trim();
  if (VERIFY_SHELL_META.test(trimmed)) return false;
  if (VERIFY_INTERPRETER_RE.test(` ${trimmed}`)) return false;
  return ALLOWED_VERIFY_PREFIXES.some(p => trimmed.startsWith(p));
}
