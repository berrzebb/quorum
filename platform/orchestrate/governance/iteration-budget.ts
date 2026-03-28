/**
 * Iteration budget management — consumption tracking + escalation decisions.
 *
 * Wraps IterationPolicy from the platform harness layer with stateful
 * tracking. Each failure produces a decision (retry / escalate / amend /
 * exhausted) and the decision is recorded in history for observability.
 */

import type { IterationPolicy } from '../../core/harness/iteration-policy.js';
import {
  shouldEscalate,
  shouldAmend,
  isExhausted,
  createIterationPolicy,
} from '../../core/harness/iteration-policy.js';

// ── State ────────────────────────────────────────────────────────────────────

export interface IterationState {
  currentAttempt: number;
  policy: IterationPolicy;
  history: Array<{
    attempt: number;
    action: 'retry' | 'escalate' | 'amend';
    reason: string;
  }>;
}

export function createIterationState(policy?: IterationPolicy): IterationState {
  return {
    currentAttempt: 0,
    policy: policy ?? createIterationPolicy(),
    history: [],
  };
}

// ── Decisions ────────────────────────────────────────────────────────────────

export type IterationDecision =
  | { action: 'proceed' }
  | { action: 'retry'; reason: string }
  | { action: 'escalate'; reason: string }
  | { action: 'amend'; reason: string }
  | { action: 'exhausted'; reason: string };

/**
 * Given a failure, decide what to do next based on iteration policy.
 * Checks exhaustion first, then amend, then escalate, then retry.
 */
export function decideNextAction(
  state: IterationState,
  failureReason: string,
): IterationDecision {
  const next = state.currentAttempt + 1;

  if (isExhausted(state.policy, next)) {
    return {
      action: 'exhausted',
      reason: `Max attempts (${state.policy.maxAttempts}) reached: ${failureReason}`,
    };
  }
  if (shouldAmend(state.policy, next)) {
    return {
      action: 'amend',
      reason: `Attempt ${next} triggers amendment: ${failureReason}`,
    };
  }
  if (shouldEscalate(state.policy, next)) {
    return {
      action: 'escalate',
      reason: `Attempt ${next} triggers escalation: ${failureReason}`,
    };
  }
  return {
    action: 'retry',
    reason: `Retrying (attempt ${next}): ${failureReason}`,
  };
}

// ── State Advancement ────────────────────────────────────────────────────────

/**
 * Record an iteration and advance the state.
 * 'proceed' decisions are no-ops (no state change).
 */
export function recordIteration(
  state: IterationState,
  decision: IterationDecision,
): IterationState {
  if (decision.action === 'proceed') return state;
  return {
    ...state,
    currentAttempt: state.currentAttempt + 1,
    history: [
      ...state.history,
      {
        attempt: state.currentAttempt + 1,
        action: decision.action === 'exhausted' ? 'amend' : decision.action,
        reason: 'reason' in decision ? decision.reason : '',
      },
    ],
  };
}
