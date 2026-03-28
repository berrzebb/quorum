import { randomUUID } from 'node:crypto';

export interface IterationPolicy {
  policyId: string;
  maxAttempts: number;
  escalationAt: number;
  amendAfter: number;
  allowStrategicRewrite: boolean;
}

export function createIterationPolicy(
  partial?: Partial<IterationPolicy>,
): IterationPolicy {
  return {
    policyId: partial?.policyId ?? randomUUID(),
    maxAttempts: partial?.maxAttempts ?? 3,
    escalationAt: partial?.escalationAt ?? 2,
    amendAfter: partial?.amendAfter ?? 3,
    allowStrategicRewrite: partial?.allowStrategicRewrite ?? false,
  };
}

export function shouldEscalate(policy: IterationPolicy, currentAttempt: number): boolean {
  return currentAttempt >= policy.escalationAt;
}

export function shouldAmend(policy: IterationPolicy, currentAttempt: number): boolean {
  return currentAttempt >= policy.amendAfter;
}

export function isExhausted(policy: IterationPolicy, currentAttempt: number): boolean {
  return currentAttempt >= policy.maxAttempts;
}
