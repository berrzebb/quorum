#!/usr/bin/env node
/**
 * Contract Negotiation Record Tests — PLT-6G
 *
 * Tests ContractNegotiationRecord type and helper functions.
 *
 * Run: node --test tests/contract-negotiation.test.mjs
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const {
  createNegotiationRecord,
  hasEvaluatorParticipation,
} = await import('../dist/platform/core/harness/index.js');

// ═══ ContractNegotiationRecord ══════════════════════════════════════════════

describe('ContractNegotiationRecord', () => {
  it('should create with defaults and generated ID', () => {
    const r = createNegotiationRecord({
      sprintContractId: 'sc-1',
      proposedBy: 'planner',
    });
    assert.ok(r.recordId, 'recordId is generated');
    assert.equal(r.sprintContractId, 'sc-1');
    assert.equal(r.proposedBy, 'planner');
    assert.equal(r.status, 'draft');
    assert.deepEqual(r.requestedChanges, []);
    assert.deepEqual(r.participants, []);
  });

  it('should accept full overrides', () => {
    const r = createNegotiationRecord({
      recordId: 'nr-42',
      sprintContractId: 'sc-2',
      proposedBy: 'evaluator',
      status: 'approved',
      requestedChanges: ['add test coverage'],
      participants: ['planner', 'evaluator'],
    });
    assert.equal(r.recordId, 'nr-42');
    assert.equal(r.proposedBy, 'evaluator');
    assert.equal(r.status, 'approved');
    assert.deepEqual(r.requestedChanges, ['add test coverage']);
    assert.deepEqual(r.participants, ['planner', 'evaluator']);
  });

  it('should generate unique IDs across calls', () => {
    const a = createNegotiationRecord({ sprintContractId: 's', proposedBy: 'planner' });
    const b = createNegotiationRecord({ sprintContractId: 's', proposedBy: 'planner' });
    assert.notEqual(a.recordId, b.recordId);
  });

  it('should support all proposedBy values', () => {
    for (const role of ['planner', 'generator', 'evaluator']) {
      const r = createNegotiationRecord({ sprintContractId: 's', proposedBy: role });
      assert.equal(r.proposedBy, role);
    }
  });

  it('should support all status values as overrides', () => {
    for (const status of ['draft', 'countered', 'approved', 'rejected']) {
      const r = createNegotiationRecord({
        sprintContractId: 's',
        proposedBy: 'planner',
        status,
      });
      assert.equal(r.status, status);
    }
  });
});

// ═══ hasEvaluatorParticipation ═══════════════════════════════════════════════

describe('hasEvaluatorParticipation', () => {
  it('returns true when a record is proposed by evaluator', () => {
    const records = [
      createNegotiationRecord({ sprintContractId: 's', proposedBy: 'evaluator' }),
    ];
    assert.equal(hasEvaluatorParticipation(records), true);
  });

  it('returns true when evaluator is in participants list', () => {
    const records = [
      createNegotiationRecord({
        sprintContractId: 's',
        proposedBy: 'planner',
        participants: ['evaluator'],
      }),
    ];
    assert.equal(hasEvaluatorParticipation(records), true);
  });

  it('returns false when no evaluator involvement', () => {
    const records = [
      createNegotiationRecord({ sprintContractId: 's', proposedBy: 'planner' }),
      createNegotiationRecord({ sprintContractId: 's', proposedBy: 'generator' }),
    ];
    assert.equal(hasEvaluatorParticipation(records), false);
  });

  it('returns false for empty array', () => {
    assert.equal(hasEvaluatorParticipation([]), false);
  });

  it('returns true with mixed records where one has evaluator', () => {
    const records = [
      createNegotiationRecord({ sprintContractId: 's', proposedBy: 'planner' }),
      createNegotiationRecord({
        sprintContractId: 's',
        proposedBy: 'generator',
        participants: ['planner', 'evaluator'],
      }),
    ];
    assert.equal(hasEvaluatorParticipation(records), true);
  });
});
