#!/usr/bin/env node
/**
 * Adaptive Gate Profile + Iteration Budget Tests — PLT-6J
 *
 * Tests selectGateProfile, getEffectiveGates, shouldRunGate from
 * orchestrate/governance/adaptive-gate-profile, and createIterationState,
 * decideNextAction, recordIteration from orchestrate/governance/iteration-budget.
 *
 * Run: node --test tests/adaptive-gate-profile.test.mjs
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const {
  MINIMAL_PROFILE,
  STANDARD_PROFILE,
  FULL_PROFILE,
  selectGateProfile,
  getEffectiveGates,
  shouldRunGate,
  createIterationState,
  decideNextAction,
  recordIteration,
} = await import('../dist/platform/orchestrate/governance/index.js');

// ═══ selectGateProfile ══════════════════════════════════════════════════════

describe('selectGateProfile', () => {
  it('returns FULL_PROFILE for security trigger', () => {
    const profile = selectGateProfile(['security']);
    assert.equal(profile.profileId, 'full');
  });

  it('returns FULL_PROFILE for cross-layer trigger', () => {
    const profile = selectGateProfile(['cross-layer']);
    assert.equal(profile.profileId, 'full');
  });

  it('returns FULL_PROFILE for api trigger', () => {
    const profile = selectGateProfile(['api']);
    assert.equal(profile.profileId, 'full');
  });

  it('returns FULL_PROFILE for data-migration trigger', () => {
    const profile = selectGateProfile(['data-migration']);
    assert.equal(profile.profileId, 'full');
  });

  it('returns STANDARD_PROFILE for default trigger', () => {
    const profile = selectGateProfile(['default']);
    assert.equal(profile.profileId, 'standard');
  });

  it('returns STANDARD_PROFILE when no triggers match', () => {
    const profile = selectGateProfile(['unknown-trigger']);
    assert.equal(profile.profileId, 'standard');
  });

  it('returns STANDARD_PROFILE for empty triggers array', () => {
    const profile = selectGateProfile([]);
    assert.equal(profile.profileId, 'standard');
  });

  it('selects highest-priority when multiple triggers match', () => {
    // 'security' matches FULL, 'default' matches STANDARD — FULL wins
    const profile = selectGateProfile(['default', 'security']);
    assert.equal(profile.profileId, 'full');
  });

  it('accepts custom profiles list', () => {
    const custom = {
      profileId: 'custom',
      triggers: ['special'],
      requiredGates: ['scope', 'test'],
      optionalGates: ['lint'],
    };
    const profile = selectGateProfile(['special'], [custom]);
    assert.equal(profile.profileId, 'custom');
  });

  it('falls back to STANDARD when custom profiles have no match', () => {
    const custom = {
      profileId: 'custom',
      triggers: ['special'],
      requiredGates: ['scope'],
      optionalGates: [],
    };
    const profile = selectGateProfile(['unknown'], [custom]);
    assert.equal(profile.profileId, 'standard');
  });

  it('returns MINIMAL_PROFILE when configured with empty triggers', () => {
    // MINIMAL has triggers: [] — never matches via trigger.
    // Only selectable if it's the sole match in a custom list with matching triggers.
    const minimal = {
      ...MINIMAL_PROFILE,
      triggers: ['trivial'],
    };
    const profile = selectGateProfile(['trivial'], [minimal]);
    assert.equal(profile.profileId, 'minimal');
  });
});

// ═══ getEffectiveGates ══════════════════════════════════════════════════════

describe('getEffectiveGates', () => {
  it('returns only required gates by default', () => {
    const gates = getEffectiveGates(STANDARD_PROFILE);
    assert.deepEqual(gates, ['scope', 'build', 'test', 'lint', 'blueprint', 'fitness']);
  });

  it('includes optional gates when requested', () => {
    const gates = getEffectiveGates(STANDARD_PROFILE, true);
    assert.deepEqual(gates, ['scope', 'build', 'test', 'lint', 'blueprint', 'fitness', 'perf', 'a11y']);
  });

  it('returns required gates for MINIMAL (no optionals)', () => {
    const gates = getEffectiveGates(MINIMAL_PROFILE, true);
    assert.deepEqual(gates, ['scope', 'build', 'test']);
  });

  it('returns all gates for FULL_PROFILE with optional', () => {
    const gates = getEffectiveGates(FULL_PROFILE, true);
    assert.ok(gates.includes('e2e'));
    assert.ok(gates.includes('runtime-evaluation'));
    assert.equal(gates.length, FULL_PROFILE.requiredGates.length + FULL_PROFILE.optionalGates.length);
  });
});

// ═══ shouldRunGate ══════════════════════════════════════════════════════════

describe('shouldRunGate', () => {
  it('returns true for a required gate', () => {
    assert.equal(shouldRunGate(STANDARD_PROFILE, 'scope'), true);
  });

  it('returns true for an optional gate', () => {
    assert.equal(shouldRunGate(STANDARD_PROFILE, 'perf'), true);
  });

  it('returns false for an unknown gate', () => {
    assert.equal(shouldRunGate(STANDARD_PROFILE, 'nonexistent-gate'), false);
  });

  it('returns false for a gate only in FULL when checking MINIMAL', () => {
    assert.equal(shouldRunGate(MINIMAL_PROFILE, 'security'), false);
  });
});

// ═══ createIterationState ═══════════════════════════════════════════════════

describe('createIterationState', () => {
  it('creates state with zero attempts', () => {
    const state = createIterationState();
    assert.equal(state.currentAttempt, 0);
    assert.equal(state.history.length, 0);
  });

  it('creates state with default policy values', () => {
    const state = createIterationState();
    assert.equal(state.policy.maxAttempts, 3);
    assert.equal(state.policy.escalationAt, 2);
    assert.equal(state.policy.amendAfter, 3);
    assert.equal(state.policy.allowStrategicRewrite, false);
  });

  it('accepts custom policy', async () => {
    const { createIterationPolicy } = await import('../dist/platform/core/harness/iteration-policy.js');
    const customPolicy = createIterationPolicy({ maxAttempts: 5, escalationAt: 3, amendAfter: 4 });
    const state = createIterationState(customPolicy);
    assert.equal(state.policy.maxAttempts, 5);
    assert.equal(state.policy.escalationAt, 3);
    assert.equal(state.policy.amendAfter, 4);
  });
});

// ═══ decideNextAction ═══════════════════════════════════════════════════════

describe('decideNextAction', () => {
  it('returns retry on first failure (attempt 0 → 1)', () => {
    const state = createIterationState();
    const decision = decideNextAction(state, 'lint error');
    assert.equal(decision.action, 'retry');
    assert.ok(decision.reason.includes('attempt 1'));
    assert.ok(decision.reason.includes('lint error'));
  });

  it('returns escalate at escalation threshold (attempt 1 → 2)', () => {
    const state = { ...createIterationState(), currentAttempt: 1 };
    const decision = decideNextAction(state, 'test failure');
    assert.equal(decision.action, 'escalate');
    assert.ok(decision.reason.includes('Attempt 2'));
  });

  it('returns exhausted at max attempts (attempt 2 → 3, default max=3)', () => {
    const state = { ...createIterationState(), currentAttempt: 2 };
    const decision = decideNextAction(state, 'persistent failure');
    assert.equal(decision.action, 'exhausted');
    assert.ok(decision.reason.includes('Max attempts'));
    assert.ok(decision.reason.includes('3'));
  });

  it('returns amend when amendAfter < maxAttempts', async () => {
    const { createIterationPolicy } = await import('../dist/platform/core/harness/iteration-policy.js');
    const policy = createIterationPolicy({ maxAttempts: 5, escalationAt: 2, amendAfter: 3 });
    const state = createIterationState(policy);
    state.currentAttempt = 2; // next = 3 → amendAfter=3
    const decision = decideNextAction(state, 'scope issue');
    assert.equal(decision.action, 'amend');
    assert.ok(decision.reason.includes('amendment'));
  });

  it('exhausted takes priority over amend when both thresholds match', () => {
    // Default: maxAttempts=3, amendAfter=3 → at attempt 2→3, isExhausted wins
    const state = { ...createIterationState(), currentAttempt: 2 };
    const decision = decideNextAction(state, 'fail');
    assert.equal(decision.action, 'exhausted');
  });
});

// ═══ recordIteration ════════════════════════════════════════════════════════

describe('recordIteration', () => {
  it('does not advance state for proceed decisions', () => {
    const state = createIterationState();
    const next = recordIteration(state, { action: 'proceed' });
    assert.equal(next.currentAttempt, 0);
    assert.equal(next.history.length, 0);
    assert.strictEqual(next, state); // same reference
  });

  it('advances currentAttempt by 1 for retry', () => {
    const state = createIterationState();
    const decision = { action: 'retry', reason: 'lint error' };
    const next = recordIteration(state, decision);
    assert.equal(next.currentAttempt, 1);
    assert.equal(next.history.length, 1);
    assert.equal(next.history[0].action, 'retry');
    assert.equal(next.history[0].attempt, 1);
  });

  it('records escalate action in history', () => {
    const state = { ...createIterationState(), currentAttempt: 1 };
    const decision = { action: 'escalate', reason: 'escalation needed' };
    const next = recordIteration(state, decision);
    assert.equal(next.currentAttempt, 2);
    assert.equal(next.history[0].action, 'escalate');
  });

  it('records exhausted as amend in history', () => {
    const state = { ...createIterationState(), currentAttempt: 2 };
    const decision = { action: 'exhausted', reason: 'max reached' };
    const next = recordIteration(state, decision);
    assert.equal(next.currentAttempt, 3);
    assert.equal(next.history[0].action, 'amend');
  });

  it('builds cumulative history across multiple iterations', () => {
    let state = createIterationState();

    // First: retry
    state = recordIteration(state, { action: 'retry', reason: 'r1' });
    assert.equal(state.currentAttempt, 1);
    assert.equal(state.history.length, 1);

    // Second: escalate
    state = recordIteration(state, { action: 'escalate', reason: 'e1' });
    assert.equal(state.currentAttempt, 2);
    assert.equal(state.history.length, 2);

    // Third: exhausted
    state = recordIteration(state, { action: 'exhausted', reason: 'done' });
    assert.equal(state.currentAttempt, 3);
    assert.equal(state.history.length, 3);

    assert.equal(state.history[0].action, 'retry');
    assert.equal(state.history[1].action, 'escalate');
    assert.equal(state.history[2].action, 'amend'); // exhausted → amend
  });

  it('does not mutate the original state', () => {
    const state = createIterationState();
    const decision = { action: 'retry', reason: 'test' };
    const next = recordIteration(state, decision);
    assert.equal(state.currentAttempt, 0);
    assert.equal(state.history.length, 0);
    assert.notStrictEqual(next, state);
  });
});
