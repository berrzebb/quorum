import type { RuntimeEvaluator, EvaluatorResult } from './evaluator-port.js';
import type { RuntimeEvaluationSpec } from '../../core/harness/runtime-evaluation-spec.js';

export class DataProbeEvaluator implements RuntimeEvaluator {
  name = 'data-probe';
  surfaces = ['data' as const];

  async run(_spec: RuntimeEvaluationSpec): Promise<EvaluatorResult> {
    // Stub — Data probe evaluation will be added when needed
    return { passed: true, findings: ['data-probe evaluation not yet implemented'], evidence: [] };
  }
}
