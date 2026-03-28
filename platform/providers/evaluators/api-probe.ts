import type { RuntimeEvaluator, EvaluatorResult } from './evaluator-port.js';
import type { RuntimeEvaluationSpec } from '../../core/harness/runtime-evaluation-spec.js';

export class ApiProbeEvaluator implements RuntimeEvaluator {
  name = 'api-probe';
  surfaces = ['api' as const];

  async run(_spec: RuntimeEvaluationSpec): Promise<EvaluatorResult> {
    // Stub — API probe evaluation will be added when needed
    return { passed: true, findings: ['api-probe evaluation not yet implemented'], evidence: [] };
  }
}
