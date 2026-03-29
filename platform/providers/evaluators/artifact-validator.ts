import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import type { RuntimeEvaluator, EvaluatorResult } from './evaluator-port.js';
import type { RuntimeEvaluationSpec } from '../../core/harness/runtime-evaluation-spec.js';

export class ArtifactValidatorEvaluator implements RuntimeEvaluator {
  name = 'artifact-validator';
  surfaces = ['artifact' as const];

  constructor(private cwd: string = process.cwd()) {}

  async run(spec: RuntimeEvaluationSpec): Promise<EvaluatorResult> {
    const artifactScenarios = spec.scenarios.filter(s => s.surface === 'artifact');
    if (artifactScenarios.length === 0) {
      return { passed: true, findings: [], evidence: [] };
    }

    const findings: string[] = [];
    const evidence: string[] = [];

    for (const scenario of artifactScenarios) {
      const targetPath = resolve(this.cwd, scenario.target);

      // Check existence
      if (!existsSync(targetPath)) {
        findings.push(`Artifact missing: ${scenario.target}`);
        continue;
      }

      const stat = statSync(targetPath);

      // Check non-empty
      if (stat.isFile() && stat.size === 0) {
        findings.push(`Artifact empty: ${scenario.target} (0 bytes)`);
        continue;
      }

      // Check success criteria (string-contains checks on file content)
      if (stat.isFile() && scenario.successCriteria.length > 0) {
        try {
          const content = readFileSync(targetPath, "utf8");
          for (const criterion of scenario.successCriteria) {
            if (!content.includes(criterion)) {
              findings.push(`Artifact ${scenario.target}: missing criterion "${criterion}"`);
            }
          }
        } catch {
          findings.push(`Artifact ${scenario.target}: unreadable`);
        }
      }

      evidence.push(`${scenario.target}: exists (${stat.size} bytes)`);
    }

    return {
      passed: findings.length === 0,
      findings,
      evidence,
    };
  }
}
