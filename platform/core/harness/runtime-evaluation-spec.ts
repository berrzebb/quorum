import { randomUUID } from 'node:crypto';

export type EvaluationSurface = 'browser' | 'cli' | 'tui' | 'api' | 'artifact' | 'data';

export interface EvaluationScenario {
  scenarioId: string;
  surface: EvaluationSurface;
  target: string;
  verifier: string;
  successCriteria: string[];
  requiredEvidence: string[];
  blocking: boolean;
}

export interface RuntimeEvaluationSpec {
  specId: string;
  scenarios: EvaluationScenario[];
  requiredEnvironments: string[];
  evidenceOutputs: string[];
}

export function createEvaluationScenario(
  partial: Partial<EvaluationScenario> & Pick<EvaluationScenario, 'surface' | 'target'>,
): EvaluationScenario {
  return {
    scenarioId: partial.scenarioId ?? randomUUID(),
    surface: partial.surface,
    target: partial.target,
    verifier: partial.verifier ?? '',
    successCriteria: partial.successCriteria ?? [],
    requiredEvidence: partial.requiredEvidence ?? [],
    blocking: partial.blocking ?? false,
  };
}

export function createRuntimeEvaluationSpec(
  partial?: Partial<RuntimeEvaluationSpec>,
): RuntimeEvaluationSpec {
  return {
    specId: partial?.specId ?? randomUUID(),
    scenarios: partial?.scenarios ?? [],
    requiredEnvironments: partial?.requiredEnvironments ?? [],
    evidenceOutputs: partial?.evidenceOutputs ?? [],
  };
}

export function getSurfacesFromSpec(spec: RuntimeEvaluationSpec): EvaluationSurface[] {
  const surfaces = new Set<EvaluationSurface>();
  for (const scenario of spec.scenarios) {
    surfaces.add(scenario.surface);
  }
  return Array.from(surfaces);
}

export function getBlockingScenarios(spec: RuntimeEvaluationSpec): EvaluationScenario[] {
  return spec.scenarios.filter((s) => s.blocking);
}
