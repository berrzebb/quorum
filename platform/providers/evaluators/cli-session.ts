import { execFileSync } from "node:child_process";
import type { RuntimeEvaluator, EvaluatorResult } from './evaluator-port.js';
import type { RuntimeEvaluationSpec } from '../../core/harness/runtime-evaluation-spec.js';

/**
 * Allowed verifier command prefixes (allowlist).
 * Only commands from trusted language specs and WB verify fields are permitted.
 */
const ALLOWED_PREFIXES = [
  "npm ", "npx ", "node ", "tsc ", "eslint ", "vitest ",
  "go ", "cargo ", "python ", "pytest ", "pip ",
  "java ", "javac ", "mvn ", "gradle ",
];

/** Shell metacharacters that enable command chaining/injection (incl. Windows %VAR% expansion). */
const SHELL_META = /[;&|`$><\r\n%]/;

/** Interpreter inline execution patterns (space or = delimited). */
const INTERPRETER_RE = /\s-[ec]\s|\s-[ec]$|\s--eval[\s=]|\s--command[\s=]/;

function isAllowedVerifier(cmd: string): boolean {
  const trimmed = cmd.trim();
  if (SHELL_META.test(trimmed)) return false;
  if (INTERPRETER_RE.test(` ${trimmed}`)) return false;
  return ALLOWED_PREFIXES.some(p => trimmed.startsWith(p));
}

export class CliSessionEvaluator implements RuntimeEvaluator {
  name = 'cli-session';
  surfaces = ['cli' as const, 'tui' as const];

  constructor(private cwd: string = process.cwd()) {}

  async run(spec: RuntimeEvaluationSpec): Promise<EvaluatorResult> {
    const cliScenarios = spec.scenarios.filter(s => s.surface === 'cli' || s.surface === 'tui');
    if (cliScenarios.length === 0) {
      return { passed: true, findings: [], evidence: [] };
    }

    const findings: string[] = [];
    const evidence: string[] = [];

    for (const scenario of cliScenarios) {
      if (!scenario.verifier) continue;
      if (!isAllowedVerifier(scenario.verifier)) {
        findings.push(`${scenario.target}: BLOCKED — verifier not in allowlist: ${scenario.verifier}`);
        continue;
      }
      const parts = scenario.verifier.trim().split(/\s+/);
      const cmd = parts[0];
      const args = parts.slice(1);
      try {
        execFileSync(cmd, args, {
          cwd: this.cwd, encoding: "utf8", timeout: 60_000,
          stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
          shell: process.platform === "win32",
        });
        evidence.push(`${scenario.target}: PASS (${scenario.verifier})`);
      } catch (err) {
        const msg = (err as { stderr?: string }).stderr?.slice(0, 200) ?? "exit non-zero";
        findings.push(`${scenario.target}: FAIL — ${scenario.verifier} — ${msg}`);
      }
    }

    return {
      passed: findings.length === 0,
      findings,
      evidence,
    };
  }
}
