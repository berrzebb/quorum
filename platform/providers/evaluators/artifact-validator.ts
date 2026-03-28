import type { RuntimeEvaluator, EvaluatorResult } from './evaluator-port.js';
import type { RuntimeEvaluationSpec } from '../../core/harness/runtime-evaluation-spec.js';

export class ArtifactValidatorEvaluator implements RuntimeEvaluator {
  name = 'artifact-validator';
  surfaces = ['artifact' as const];

  async run(_spec: RuntimeEvaluationSpec): Promise<EvaluatorResult> {
    // Stub — Artifact validation will be added when needed
    return { passed: true, findings: ['artifact-validator evaluation not yet implemented'], evidence: [] };
  }
}
