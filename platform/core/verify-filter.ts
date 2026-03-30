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

/** Interpreters that allow inline code execution and should be blocked with -e/-c flags. */
const DANGEROUS_INLINE_INTERPRETERS = /^(python|python3|ruby|perl|php)\s/;

/**
 * Check if a verifier command is allowed.
 * Three-layer defense: allowlist prefix + metachar filter + interpreter inline filter.
 *
 * Supports `&&`-chained commands: "npx tsc --noEmit && npx vitest run"
 * Each sub-command is validated independently. Other shell operators (;|`$) remain blocked.
 *
 * `node -e` is allowed (common for inline verification checks).
 * `python -c`, `ruby -e`, etc. are blocked (arbitrary code execution risk).
 */
export function isAllowedVerifier(cmd: string): boolean {
  const trimmed = cmd.trim();

  // Allow && chaining by splitting and validating each part
  if (trimmed.includes("&&")) {
    const parts = trimmed.split("&&").map(p => p.trim()).filter(Boolean);
    return parts.length > 0 && parts.every(p => isAllowedVerifier(p));
  }

  if (VERIFY_SHELL_META.test(trimmed)) return false;

  // Only block inline execution for dangerous interpreters, not node
  if (DANGEROUS_INLINE_INTERPRETERS.test(trimmed) && VERIFY_INTERPRETER_RE.test(` ${trimmed}`)) return false;

  return ALLOWED_VERIFY_PREFIXES.some(p => trimmed.startsWith(p));
}
