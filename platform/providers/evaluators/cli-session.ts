import { execSync } from "node:child_process";
import type { RuntimeEvaluator, EvaluatorResult } from './evaluator-port.js';
import type { RuntimeEvaluationSpec } from '../../core/harness/runtime-evaluation-spec.js';

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
      try {
        const output = execSync(scenario.verifier, {
          cwd: this.cwd, encoding: "utf8", timeout: 60_000,
          stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
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
