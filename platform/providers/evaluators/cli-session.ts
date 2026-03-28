import type { RuntimeEvaluator, EvaluatorResult } from './evaluator-port.js';
import type { RuntimeEvaluationSpec } from '../../core/harness/runtime-evaluation-spec.js';

export class CliSessionEvaluator implements RuntimeEvaluator {
  name = 'cli-session';
  surfaces = ['cli' as const, 'tui' as const];

  async run(_spec: RuntimeEvaluationSpec): Promise<EvaluatorResult> {
    // Stub — CLI/TUI session evaluation will be added when needed
    return { passed: true, findings: ['cli-session evaluation not yet implemented'], evidence: [] };
  }
}
