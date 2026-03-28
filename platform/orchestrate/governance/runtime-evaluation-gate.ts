/**
 * Runtime evaluation gate — surface-matched evaluation enforcement.
 *
 * Runs runtime evaluations for each surface in a spec using available
 * evaluators. Blocking surfaces cause gate failure if their evaluator
 * is missing or if evaluation fails.
 */

import type { RuntimeEvaluationSpec, EvaluationSurface } from '../../core/harness/runtime-evaluation-spec.js';
import { getSurfacesFromSpec, getBlockingScenarios } from '../../core/harness/runtime-evaluation-spec.js';
import type { RuntimeEvaluator, EvaluatorResult } from '../../providers/evaluators/evaluator-port.js';
import { selectEvaluator } from '../../providers/evaluators/evaluator-port.js';

export interface RuntimeEvaluationGateResult {
  passed: boolean;
  surfaceResults: Array<{
    surface: EvaluationSurface;
    evaluatorName: string | null;
    result: EvaluatorResult | null;
  }>;
  missingEvaluators: EvaluationSurface[];
  blockingFailures: string[];
}

/**
 * Run runtime evaluation for a spec using available evaluators.
 * Returns gate result with per-surface breakdown.
 */
export async function runRuntimeEvaluationGate(
  spec: RuntimeEvaluationSpec,
  evaluators: RuntimeEvaluator[]
): Promise<RuntimeEvaluationGateResult> {
  const surfaces = getSurfacesFromSpec(spec);
  const blockingScenarios = getBlockingScenarios(spec);
  const blockingSurfaces = new Set(blockingScenarios.map(s => s.surface));

  const surfaceResults: RuntimeEvaluationGateResult['surfaceResults'] = [];
  const missingEvaluators: EvaluationSurface[] = [];
  const blockingFailures: string[] = [];

  for (const surface of surfaces) {
    const evaluator = selectEvaluator(evaluators, surface);
    if (!evaluator) {
      missingEvaluators.push(surface);
      surfaceResults.push({ surface, evaluatorName: null, result: null });
      if (blockingSurfaces.has(surface)) {
        blockingFailures.push(`No evaluator for blocking surface: ${surface}`);
      }
      continue;
    }

    const result = await evaluator.run(spec);
    surfaceResults.push({ surface, evaluatorName: evaluator.name, result });

    if (!result.passed && blockingSurfaces.has(surface)) {
      blockingFailures.push(`${surface} evaluation failed: ${result.findings.join(', ')}`);
    }
  }

  return {
    passed: blockingFailures.length === 0,
    surfaceResults,
    missingEvaluators,
    blockingFailures,
  };
}
