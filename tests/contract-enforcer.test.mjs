#!/usr/bin/env node
/**
 * Contract Models & Ledger Tests — PLT-6D
 *
 * Tests SprintContract, EvaluationContract, HandoffArtifact types,
 * their helper functions, and InMemoryContractLedger.
 *
 * Run: node --test tests/contract-enforcer.test.mjs
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

// Import from compiled dist (platform/**/*.ts → dist/platform/**)
const {
  createSprintContract,
  isApproved,
  createEvaluationContract,
  meetsThresholds,
  createHandoffArtifact,
  isComplete,
  InMemoryContractLedger,
} = await import('../dist/platform/core/harness/index.js');

// ═══ 1. SprintContract ══════════════════════════════════════════════════

describe('SprintContract', () => {
  it('should create with defaults (draft state, generated ID)', () => {
    const sc = createSprintContract({ trackName: 'track-a', waveId: 'w-1' });
    assert.ok(sc.contractId, 'contractId is generated');
    assert.equal(sc.trackName, 'track-a');
    assert.equal(sc.waveId, 'w-1');
    assert.deepEqual(sc.scope, []);
    assert.deepEqual(sc.doneCriteria, []);
    assert.deepEqual(sc.evidenceRequired, []);
    assert.equal(sc.approvalState, 'draft');
  });

  it('should accept overrides', () => {
    const sc = createSprintContract({
      contractId: 'custom-id',
      trackName: 'track-b',
      waveId: 'w-2',
      scope: ['file-a.ts'],
      doneCriteria: ['tests pass'],
      evidenceRequired: ['coverage report'],
      approvalState: 'approved',
    });
    assert.equal(sc.contractId, 'custom-id');
    assert.deepEqual(sc.scope, ['file-a.ts']);
    assert.equal(sc.approvalState, 'approved');
  });

  it('isApproved returns false for draft', () => {
    const sc = createSprintContract({ trackName: 't', waveId: 'w' });
    assert.equal(isApproved(sc), false);
  });

  it('isApproved returns true for approved', () => {
    const sc = createSprintContract({
      trackName: 't',
      waveId: 'w',
      approvalState: 'approved',
    });
    assert.equal(isApproved(sc), true);
  });

  it('isApproved returns false for rejected', () => {
    const sc = createSprintContract({
      trackName: 't',
      waveId: 'w',
      approvalState: 'rejected',
    });
    assert.equal(isApproved(sc), false);
  });
});

// ═══ 2. EvaluationContract ══════════════════════════════════════════════

describe('EvaluationContract', () => {
  it('should create with defaults', () => {
    const ec = createEvaluationContract();
    assert.ok(ec.contractId, 'contractId is generated');
    assert.deepEqual(ec.blockingChecks, []);
    assert.deepEqual(ec.thresholds, {});
    assert.equal(ec.failureDisposition, 'block');
  });

  it('should accept overrides', () => {
    const ec = createEvaluationContract({
      contractId: 'eval-1',
      blockingChecks: ['lint', 'typecheck'],
      thresholds: { coverage: 0.8, fitness: 0.7 },
      failureDisposition: 'retry',
    });
    assert.equal(ec.contractId, 'eval-1');
    assert.deepEqual(ec.blockingChecks, ['lint', 'typecheck']);
    assert.equal(ec.thresholds.coverage, 0.8);
    assert.equal(ec.failureDisposition, 'retry');
  });

  it('meetsThresholds returns true when all scores meet or exceed', () => {
    const ec = createEvaluationContract({
      thresholds: { coverage: 0.8, fitness: 0.7 },
    });
    assert.equal(meetsThresholds(ec, { coverage: 0.9, fitness: 0.7 }), true);
  });

  it('meetsThresholds returns false when a score is below threshold', () => {
    const ec = createEvaluationContract({
      thresholds: { coverage: 0.8, fitness: 0.7 },
    });
    assert.equal(meetsThresholds(ec, { coverage: 0.5, fitness: 0.9 }), false);
  });

  it('meetsThresholds returns false when a required score is missing', () => {
    const ec = createEvaluationContract({
      thresholds: { coverage: 0.8 },
    });
    assert.equal(meetsThresholds(ec, {}), false);
  });

  it('meetsThresholds returns true when thresholds is empty', () => {
    const ec = createEvaluationContract({ thresholds: {} });
    assert.equal(meetsThresholds(ec, { anything: 0.1 }), true);
  });
});

// ═══ 3. HandoffArtifact ═════════════════════════════════════════════════

describe('HandoffArtifact', () => {
  it('should create with defaults', () => {
    const ha = createHandoffArtifact({ contractId: 'c-1' });
    assert.equal(ha.contractId, 'c-1');
    assert.equal(ha.summary, '');
    assert.deepEqual(ha.openItems, []);
    assert.deepEqual(ha.residualRisks, []);
    assert.deepEqual(ha.rtmRefs, []);
    assert.equal(ha.nextAction, '');
  });

  it('isComplete returns true for a well-formed artifact', () => {
    const ha = createHandoffArtifact({
      contractId: 'c-1',
      summary: 'All done',
      nextAction: 'Deploy to staging',
      openItems: ['item-1'],
    });
    assert.equal(isComplete(ha), true);
  });

  it('isComplete returns false when summary is empty', () => {
    const ha = createHandoffArtifact({
      contractId: 'c-1',
      nextAction: 'Deploy',
    });
    assert.equal(isComplete(ha), false);
  });

  it('isComplete returns false when nextAction is empty', () => {
    const ha = createHandoffArtifact({
      contractId: 'c-1',
      summary: 'Done',
    });
    assert.equal(isComplete(ha), false);
  });

  it('isComplete returns false when openItems contains an empty string', () => {
    const ha = createHandoffArtifact({
      contractId: 'c-1',
      summary: 'Done',
      nextAction: 'Deploy',
      openItems: ['valid item', ''],
    });
    assert.equal(isComplete(ha), false);
  });
});

// ═══ 4. InMemoryContractLedger ══════════════════════════════════════════

describe('InMemoryContractLedger', () => {
  it('should store and retrieve a SprintContract', () => {
    const ledger = new InMemoryContractLedger();
    const sc = createSprintContract({ trackName: 'track-x', waveId: 'w-1' });
    ledger.storeSprintContract(sc);
    const retrieved = ledger.getSprintContract(sc.contractId);
    assert.deepEqual(retrieved, sc);
  });

  it('should return undefined for unknown contractId', () => {
    const ledger = new InMemoryContractLedger();
    assert.equal(ledger.getSprintContract('nonexistent'), undefined);
    assert.equal(ledger.getEvaluationContract('nonexistent'), undefined);
    assert.equal(ledger.getHandoffArtifact('nonexistent'), undefined);
  });

  it('should store and retrieve an EvaluationContract', () => {
    const ledger = new InMemoryContractLedger();
    const ec = createEvaluationContract({
      blockingChecks: ['typecheck'],
      thresholds: { coverage: 0.8 },
    });
    ledger.storeEvaluationContract(ec);
    const retrieved = ledger.getEvaluationContract(ec.contractId);
    assert.deepEqual(retrieved, ec);
  });

  it('should store and retrieve a HandoffArtifact', () => {
    const ledger = new InMemoryContractLedger();
    const ha = createHandoffArtifact({
      contractId: 'ha-1',
      summary: 'Completed wave',
      nextAction: 'Run integration tests',
    });
    ledger.storeHandoffArtifact(ha);
    const retrieved = ledger.getHandoffArtifact('ha-1');
    assert.deepEqual(retrieved, ha);
  });

  it('listSprintContracts returns all when no filter', () => {
    const ledger = new InMemoryContractLedger();
    const sc1 = createSprintContract({ trackName: 'a', waveId: 'w-1' });
    const sc2 = createSprintContract({ trackName: 'b', waveId: 'w-2' });
    ledger.storeSprintContract(sc1);
    ledger.storeSprintContract(sc2);
    const all = ledger.listSprintContracts();
    assert.equal(all.length, 2);
  });

  it('listSprintContracts filters by trackName', () => {
    const ledger = new InMemoryContractLedger();
    const sc1 = createSprintContract({ trackName: 'alpha', waveId: 'w-1' });
    const sc2 = createSprintContract({ trackName: 'beta', waveId: 'w-2' });
    const sc3 = createSprintContract({ trackName: 'alpha', waveId: 'w-3' });
    ledger.storeSprintContract(sc1);
    ledger.storeSprintContract(sc2);
    ledger.storeSprintContract(sc3);
    const alphaOnly = ledger.listSprintContracts('alpha');
    assert.equal(alphaOnly.length, 2);
    assert.ok(alphaOnly.every((c) => c.trackName === 'alpha'));
  });

  it('listSprintContracts returns empty array when no matches', () => {
    const ledger = new InMemoryContractLedger();
    ledger.storeSprintContract(
      createSprintContract({ trackName: 'x', waveId: 'w-1' }),
    );
    const result = ledger.listSprintContracts('nonexistent');
    assert.deepEqual(result, []);
  });

  it('should overwrite on duplicate contractId', () => {
    const ledger = new InMemoryContractLedger();
    const sc = createSprintContract({
      contractId: 'dup-id',
      trackName: 'a',
      waveId: 'w-1',
    });
    ledger.storeSprintContract(sc);
    const updated = { ...sc, approvalState: 'approved' };
    ledger.storeSprintContract(updated);
    const retrieved = ledger.getSprintContract('dup-id');
    assert.equal(retrieved.approvalState, 'approved');
  });
});
