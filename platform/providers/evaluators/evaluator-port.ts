import type { EvaluationSurface, RuntimeEvaluationSpec } from '../../core/harness/runtime-evaluation-spec.js';

export interface EvaluatorResult {
  passed: boolean;
  findings: string[];
  evidence: string[];
}

export interface RuntimeEvaluator {
  name: string;
  surfaces: EvaluationSurface[];
  run(spec: RuntimeEvaluationSpec): Promise<EvaluatorResult>;
}

/** Find the first evaluator that supports the given surface. */
export function selectEvaluator(
  evaluators: RuntimeEvaluator[],
  surface: EvaluationSurface,
): RuntimeEvaluator | undefined {
  return evaluators.find((e) => e.surfaces.includes(surface));
}

/**
 * @deprecated Use runRuntimeEvaluationGate() from governance/runtime-evaluation-gate.ts instead.
 * It provides blocking/non-blocking surface classification and gate result.
 *
 * Run all scenarios for a spec using available evaluators.
 * For each unique surface in the spec's scenarios, finds the matching
 * evaluator and runs it.  Returns `null` result when no evaluator is
 * available for a surface.
 */
export async function runEvaluation(
  evaluators: RuntimeEvaluator[],
  spec: RuntimeEvaluationSpec,
): Promise<{ surface: EvaluationSurface; result: EvaluatorResult | null }[]> {
  const seen = new Set<EvaluationSurface>();
  const surfaces: EvaluationSurface[] = [];
  for (const scenario of spec.scenarios) {
    if (!seen.has(scenario.surface)) {
      seen.add(scenario.surface);
      surfaces.push(scenario.surface);
    }
  }

  const results: { surface: EvaluationSurface; result: EvaluatorResult | null }[] = [];
  for (const surface of surfaces) {
    const evaluator = selectEvaluator(evaluators, surface);
    if (!evaluator) {
      results.push({ surface, result: null });
    } else {
      const result = await evaluator.run(spec);
      results.push({ surface, result });
    }
  }
  return results;
}
