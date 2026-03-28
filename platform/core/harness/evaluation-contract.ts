import { randomUUID } from 'node:crypto';

export interface EvaluationContract {
  contractId: string;
  blockingChecks: string[];
  thresholds: Record<string, number>;
  failureDisposition: 'block' | 'retry' | 'amend';
}

export function createEvaluationContract(
  partial?: Partial<EvaluationContract>,
): EvaluationContract {
  return {
    contractId: partial?.contractId ?? randomUUID(),
    blockingChecks: partial?.blockingChecks ?? [],
    thresholds: partial?.thresholds ?? {},
    failureDisposition: partial?.failureDisposition ?? 'block',
  };
}

export function meetsThresholds(
  contract: EvaluationContract,
  scores: Record<string, number>,
): boolean {
  for (const [key, required] of Object.entries(contract.thresholds)) {
    const actual = scores[key];
    if (actual === undefined || actual < required) {
      return false;
    }
  }
  return true;
}
