import { randomUUID } from 'node:crypto';

export interface QualityDimension {
  name: string;
  kind: 'objective' | 'qualitative';
  threshold?: number;
}

export interface QualityRubric {
  rubricId: string;
  dimensions: QualityDimension[];
}

export function createQualityRubric(
  partial?: Partial<QualityRubric>,
): QualityRubric {
  return {
    rubricId: partial?.rubricId ?? randomUUID(),
    dimensions: partial?.dimensions ?? [],
  };
}

export function evaluateRubric(
  rubric: QualityRubric,
  scores: Record<string, number>,
): { passed: boolean; failures: string[] } {
  const failures: string[] = [];
  for (const dim of rubric.dimensions) {
    if (dim.kind !== 'objective' || dim.threshold === undefined) continue;
    const actual = scores[dim.name];
    if (actual === undefined || actual < dim.threshold) {
      failures.push(dim.name);
    }
  }
  return { passed: failures.length === 0, failures };
}
