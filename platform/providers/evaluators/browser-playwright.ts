import type { RuntimeEvaluator, EvaluatorResult } from './evaluator-port.js';
import type { RuntimeEvaluationSpec } from '../../core/harness/runtime-evaluation-spec.js';

export class BrowserPlaywrightEvaluator implements RuntimeEvaluator {
  name = 'browser-playwright';
  surfaces = ['browser' as const];

  async run(_spec: RuntimeEvaluationSpec): Promise<EvaluatorResult> {
    // Stub — Playwright integration will be added when needed
    return { passed: true, findings: ['browser evaluation not yet implemented'], evidence: [] };
  }
}
