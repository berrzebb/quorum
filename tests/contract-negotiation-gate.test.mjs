#!/usr/bin/env node
/**
 * Contract Negotiation Gate Tests — PLT-6I
 *
 * Tests validateNegotiation and approveWithNegotiation from the
 * orchestrate/planning layer.
 *
 * Run: node --test tests/contract-negotiation-gate.test.mjs
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const {
  createSprintContract,
} = await import('../dist/platform/core/harness/index.js');

const {
  createNegotiationRecord,
} = await import('../dist/platform/core/harness/index.js');

const {
  validateNegotiation,
  approveWithNegotiation,
} = await import('../dist/orchestrate/planning/index.js');

// ═══ validateNegotiation ════════════════════════════════════════════════════

describe('validateNegotiation', () => {
  it('passes for draft contracts (not yet approved)', () => {
    const contract = createSprintContract({
      trackName: 'track-1',
      waveId: 'w-1',
      approvalState: 'draft',
    });
    const result = validateNegotiation({ sprintContract: contract, records: [] });
    assert.equal(result.valid, true);
    assert.equal(result.reason, undefined);
  });

  it('passes for rejected contracts', () => {
    const contract = createSprintContract({
      trackName: 'track-1',
      waveId: 'w-1',
      approvalState: 'rejected',
    });
    const result = validateNegotiation({ sprintContract: contract, records: [] });
    assert.equal(result.valid, true);
  });

  it('fails for approved contract without evaluator participation', () => {
    const contract = createSprintContract({
      trackName: 'track-1',
      waveId: 'w-1',
      approvalState: 'approved',
    });
    const records = [
      createNegotiationRecord({ sprintContractId: contract.contractId, proposedBy: 'planner' }),
    ];
    const result = validateNegotiation({ sprintContract: contract, records });
    assert.equal(result.valid, false);
    assert.ok(result.reason.includes('evaluator'));
  });

  it('fails for approved contract with empty records', () => {
    const contract = createSprintContract({
      trackName: 'track-1',
      waveId: 'w-1',
      approvalState: 'approved',
    });
    const result = validateNegotiation({ sprintContract: contract, records: [] });
    assert.equal(result.valid, false);
    assert.ok(result.reason.includes('evaluator'));
  });

  it('passes for approved contract with evaluator as proposer', () => {
    const contract = createSprintContract({
      trackName: 'track-1',
      waveId: 'w-1',
      approvalState: 'approved',
    });
    const records = [
      createNegotiationRecord({ sprintContractId: contract.contractId, proposedBy: 'evaluator' }),
    ];
    const result = validateNegotiation({ sprintContract: contract, records });
    assert.equal(result.valid, true);
  });

  it('passes for approved contract with evaluator in participants', () => {
    const contract = createSprintContract({
      trackName: 'track-1',
      waveId: 'w-1',
      approvalState: 'approved',
    });
    const records = [
      createNegotiationRecord({
        sprintContractId: contract.contractId,
        proposedBy: 'planner',
        participants: ['evaluator'],
      }),
    ];
    const result = validateNegotiation({ sprintContract: contract, records });
    assert.equal(result.valid, true);
  });
});

// ═══ approveWithNegotiation ═════════════════════════════════════════════════

describe('approveWithNegotiation', () => {
  it('throws when no evaluator participation', () => {
    const contract = createSprintContract({
      trackName: 'track-1',
      waveId: 'w-1',
    });
    const records = [
      createNegotiationRecord({ sprintContractId: contract.contractId, proposedBy: 'planner' }),
    ];
    assert.throws(
      () => approveWithNegotiation(contract, records),
      /evaluator-side negotiation required/,
    );
  });

  it('throws with empty records', () => {
    const contract = createSprintContract({
      trackName: 'track-1',
      waveId: 'w-1',
    });
    assert.throws(
      () => approveWithNegotiation(contract, []),
      /evaluator-side negotiation required/,
    );
  });

  it('returns approved contract when evaluator participated as proposer', () => {
    const contract = createSprintContract({
      trackName: 'track-1',
      waveId: 'w-1',
      approvalState: 'draft',
    });
    const records = [
      createNegotiationRecord({ sprintContractId: contract.contractId, proposedBy: 'evaluator' }),
    ];
    const result = approveWithNegotiation(contract, records);
    assert.equal(result.approvalState, 'approved');
    assert.equal(result.trackName, 'track-1');
  });

  it('returns approved contract when evaluator is in participants', () => {
    const contract = createSprintContract({
      trackName: 'track-1',
      waveId: 'w-1',
      approvalState: 'draft',
    });
    const records = [
      createNegotiationRecord({
        sprintContractId: contract.contractId,
        proposedBy: 'generator',
        participants: ['planner', 'evaluator'],
      }),
    ];
    const result = approveWithNegotiation(contract, records);
    assert.equal(result.approvalState, 'approved');
  });

  it('does not mutate the original contract', () => {
    const contract = createSprintContract({
      trackName: 'track-1',
      waveId: 'w-1',
      approvalState: 'draft',
    });
    const records = [
      createNegotiationRecord({ sprintContractId: contract.contractId, proposedBy: 'evaluator' }),
    ];
    const result = approveWithNegotiation(contract, records);
    assert.equal(contract.approvalState, 'draft');
    assert.equal(result.approvalState, 'approved');
    assert.notEqual(contract, result);
  });

  it('includes contractId in error message', () => {
    const contract = createSprintContract({
      contractId: 'sc-unique-42',
      trackName: 'track-1',
      waveId: 'w-1',
    });
    assert.throws(
      () => approveWithNegotiation(contract, []),
      /sc-unique-42/,
    );
  });
});
