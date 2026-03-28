#!/usr/bin/env node
/**
 * Contract Enforcement Gate Tests — PLT-6E
 *
 * Tests StrictContractEnforcer (assert methods), PromotionGate, and HandoffGate.
 *
 * Run: node --test tests/handoff-gate.test.mjs
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const {
  createSprintContract,
  createEvaluationContract,
  createHandoffArtifact,
  InMemoryContractLedger,
} = await import('../dist/platform/core/harness/index.js');

const {
  ContractViolationError,
  StrictContractEnforcer,
} = await import('../dist/platform/bus/contract-enforcer.js');

const { PromotionGate } = await import('../dist/platform/bus/promotion-gate.js');
const { HandoffGate } = await import('../dist/platform/bus/handoff-gate.js');

// ═══ 1. StrictContractEnforcer ═══════════════════════════════════════════

describe('StrictContractEnforcer', () => {
  const enforcer = new StrictContractEnforcer();

  // ── assertSprintApproved ──────────────────

  describe('assertSprintApproved', () => {
    it('throws for draft contract', () => {
      const sc = createSprintContract({ trackName: 't', waveId: 'w' });
      assert.throws(
        () => enforcer.assertSprintApproved(sc),
        (err) => {
          assert.ok(err instanceof ContractViolationError);
          assert.equal(err.gate, 'sprint');
          assert.ok(err.message.includes('not approved'));
          assert.ok(err.message.includes('draft'));
          return true;
        },
      );
    });

    it('throws for rejected contract', () => {
      const sc = createSprintContract({
        trackName: 't',
        waveId: 'w',
        approvalState: 'rejected',
      });
      assert.throws(
        () => enforcer.assertSprintApproved(sc),
        (err) => {
          assert.ok(err instanceof ContractViolationError);
          assert.equal(err.gate, 'sprint');
          assert.ok(err.message.includes('rejected'));
          return true;
        },
      );
    });

    it('passes for approved contract', () => {
      const sc = createSprintContract({
        trackName: 't',
        waveId: 'w',
        approvalState: 'approved',
      });
      // Should not throw
      enforcer.assertSprintApproved(sc);
    });
  });

  // ── assertEvaluationReady ─────────────────

  describe('assertEvaluationReady', () => {
    it('throws when thresholds not met', () => {
      const ec = createEvaluationContract({
        thresholds: { coverage: 0.8, fitness: 0.7 },
      });
      assert.throws(
        () => enforcer.assertEvaluationReady(ec, { coverage: 0.5, fitness: 0.9 }),
        (err) => {
          assert.ok(err instanceof ContractViolationError);
          assert.equal(err.gate, 'evaluation');
          assert.ok(err.message.includes('thresholds not met'));
          return true;
        },
      );
    });

    it('throws when required score is missing', () => {
      const ec = createEvaluationContract({
        thresholds: { coverage: 0.8 },
      });
      assert.throws(
        () => enforcer.assertEvaluationReady(ec, {}),
        (err) => {
          assert.ok(err instanceof ContractViolationError);
          assert.equal(err.gate, 'evaluation');
          return true;
        },
      );
    });

    it('passes when all thresholds met', () => {
      const ec = createEvaluationContract({
        thresholds: { coverage: 0.8, fitness: 0.7 },
      });
      // Should not throw
      enforcer.assertEvaluationReady(ec, { coverage: 0.85, fitness: 0.75 });
    });

    it('passes when thresholds empty', () => {
      const ec = createEvaluationContract({ thresholds: {} });
      enforcer.assertEvaluationReady(ec, {});
    });
  });

  // ── assertHandoffComplete ─────────────────

  describe('assertHandoffComplete', () => {
    it('throws for incomplete handoff (missing summary)', () => {
      const ha = createHandoffArtifact({
        contractId: 'c-1',
        nextAction: 'Deploy',
      });
      assert.throws(
        () => enforcer.assertHandoffComplete(ha),
        (err) => {
          assert.ok(err instanceof ContractViolationError);
          assert.equal(err.gate, 'handoff');
          assert.ok(err.message.includes('incomplete'));
          return true;
        },
      );
    });

    it('throws for incomplete handoff (missing nextAction)', () => {
      const ha = createHandoffArtifact({
        contractId: 'c-1',
        summary: 'Done',
      });
      assert.throws(
        () => enforcer.assertHandoffComplete(ha),
        (err) => {
          assert.ok(err instanceof ContractViolationError);
          assert.equal(err.gate, 'handoff');
          return true;
        },
      );
    });

    it('throws for incomplete handoff (empty openItem)', () => {
      const ha = createHandoffArtifact({
        contractId: 'c-1',
        summary: 'Done',
        nextAction: 'Deploy',
        openItems: ['valid', ''],
      });
      assert.throws(
        () => enforcer.assertHandoffComplete(ha),
        (err) => {
          assert.ok(err instanceof ContractViolationError);
          assert.equal(err.gate, 'handoff');
          return true;
        },
      );
    });

    it('passes for complete handoff', () => {
      const ha = createHandoffArtifact({
        contractId: 'c-1',
        summary: 'All tasks completed',
        nextAction: 'Deploy to staging',
        openItems: ['Follow-up item'],
      });
      // Should not throw
      enforcer.assertHandoffComplete(ha);
    });
  });

  // ── assertPromotionAllowed ────────────────

  describe('assertPromotionAllowed', () => {
    it('throws when sprint not approved', () => {
      const sprint = createSprintContract({ trackName: 't', waveId: 'w' });
      const evaluation = createEvaluationContract({ thresholds: {} });
      assert.throws(
        () => enforcer.assertPromotionAllowed({
          sprint,
          evaluation,
          scores: {},
        }),
        (err) => {
          assert.ok(err instanceof ContractViolationError);
          assert.equal(err.gate, 'sprint');
          return true;
        },
      );
    });

    it('throws when evaluation thresholds not met', () => {
      const sprint = createSprintContract({
        trackName: 't',
        waveId: 'w',
        approvalState: 'approved',
      });
      const evaluation = createEvaluationContract({
        thresholds: { coverage: 0.9 },
      });
      assert.throws(
        () => enforcer.assertPromotionAllowed({
          sprint,
          evaluation,
          scores: { coverage: 0.5 },
        }),
        (err) => {
          assert.ok(err instanceof ContractViolationError);
          assert.equal(err.gate, 'evaluation');
          return true;
        },
      );
    });

    it('throws when handoff is incomplete', () => {
      const sprint = createSprintContract({
        trackName: 't',
        waveId: 'w',
        approvalState: 'approved',
      });
      const evaluation = createEvaluationContract({ thresholds: {} });
      const handoff = createHandoffArtifact({ contractId: 'c-1' });
      assert.throws(
        () => enforcer.assertPromotionAllowed({
          sprint,
          evaluation,
          scores: {},
          handoff,
        }),
        (err) => {
          assert.ok(err instanceof ContractViolationError);
          assert.equal(err.gate, 'handoff');
          return true;
        },
      );
    });

    it('passes when all conditions met (without handoff)', () => {
      const sprint = createSprintContract({
        trackName: 't',
        waveId: 'w',
        approvalState: 'approved',
      });
      const evaluation = createEvaluationContract({
        thresholds: { coverage: 0.8 },
      });
      enforcer.assertPromotionAllowed({
        sprint,
        evaluation,
        scores: { coverage: 0.9 },
      });
    });

    it('passes when all conditions met (with handoff)', () => {
      const sprint = createSprintContract({
        trackName: 't',
        waveId: 'w',
        approvalState: 'approved',
      });
      const evaluation = createEvaluationContract({ thresholds: {} });
      const handoff = createHandoffArtifact({
        contractId: 'c-1',
        summary: 'Done',
        nextAction: 'Deploy',
      });
      enforcer.assertPromotionAllowed({
        sprint,
        evaluation,
        scores: {},
        handoff,
      });
    });
  });
});

// ═══ 2. PromotionGate ════════════════════════════════════════════════════

describe('PromotionGate', () => {
  function makeLedger() {
    return new InMemoryContractLedger();
  }

  // ── canStartWave ──────────────────────────

  describe('canStartWave', () => {
    it('returns allowed:false for missing sprint contract', () => {
      const ledger = makeLedger();
      const gate = new PromotionGate(ledger);
      const result = gate.canStartWave('nonexistent');
      assert.equal(result.allowed, false);
      assert.ok(result.reason.includes('not found'));
    });

    it('returns allowed:false for draft sprint contract', () => {
      const ledger = makeLedger();
      const sc = createSprintContract({ trackName: 't', waveId: 'w' });
      ledger.storeSprintContract(sc);
      const gate = new PromotionGate(ledger);
      const result = gate.canStartWave(sc.contractId);
      assert.equal(result.allowed, false);
      assert.ok(result.reason.includes('not approved'));
    });

    it('returns allowed:true for approved sprint contract', () => {
      const ledger = makeLedger();
      const sc = createSprintContract({
        trackName: 't',
        waveId: 'w',
        approvalState: 'approved',
      });
      ledger.storeSprintContract(sc);
      const gate = new PromotionGate(ledger);
      const result = gate.canStartWave(sc.contractId);
      assert.equal(result.allowed, true);
      assert.equal(result.reason, undefined);
    });
  });

  // ── canPromote ────────────────────────────

  describe('canPromote', () => {
    it('returns allowed:false for missing sprint contract', () => {
      const ledger = makeLedger();
      const gate = new PromotionGate(ledger);
      const result = gate.canPromote('nonexistent', {});
      assert.equal(result.allowed, false);
      assert.ok(result.reason.includes('Sprint contract not found'));
    });

    it('returns allowed:false for missing evaluation contract', () => {
      const ledger = makeLedger();
      const sc = createSprintContract({
        trackName: 't',
        waveId: 'w',
        approvalState: 'approved',
      });
      ledger.storeSprintContract(sc);
      const gate = new PromotionGate(ledger);
      const result = gate.canPromote(sc.contractId, {});
      assert.equal(result.allowed, false);
      assert.ok(result.reason.includes('Evaluation contract not found'));
    });

    it('returns allowed:false when sprint not approved', () => {
      const ledger = makeLedger();
      const sc = createSprintContract({ trackName: 't', waveId: 'w' });
      const ec = createEvaluationContract({
        contractId: sc.contractId,
        thresholds: {},
      });
      ledger.storeSprintContract(sc);
      ledger.storeEvaluationContract(ec);
      const gate = new PromotionGate(ledger);
      const result = gate.canPromote(sc.contractId, {});
      assert.equal(result.allowed, false);
      assert.ok(result.reason.includes('not approved'));
    });

    it('returns allowed:false when evaluation thresholds not met', () => {
      const ledger = makeLedger();
      const id = 'shared-id';
      const sc = createSprintContract({
        contractId: id,
        trackName: 't',
        waveId: 'w',
        approvalState: 'approved',
      });
      const ec = createEvaluationContract({
        contractId: id,
        thresholds: { coverage: 0.9 },
      });
      ledger.storeSprintContract(sc);
      ledger.storeEvaluationContract(ec);
      const gate = new PromotionGate(ledger);
      const result = gate.canPromote(id, { coverage: 0.5 });
      assert.equal(result.allowed, false);
      assert.ok(result.reason.includes('thresholds not met'));
    });

    it('returns allowed:true when sprint approved and thresholds met', () => {
      const ledger = makeLedger();
      const id = 'shared-id';
      const sc = createSprintContract({
        contractId: id,
        trackName: 't',
        waveId: 'w',
        approvalState: 'approved',
      });
      const ec = createEvaluationContract({
        contractId: id,
        thresholds: { coverage: 0.8 },
      });
      ledger.storeSprintContract(sc);
      ledger.storeEvaluationContract(ec);
      const gate = new PromotionGate(ledger);
      const result = gate.canPromote(id, { coverage: 0.85 });
      assert.equal(result.allowed, true);
    });
  });
});

// ═══ 3. HandoffGate ══════════════════════════════════════════════════════

describe('HandoffGate', () => {
  function makeLedger() {
    return new InMemoryContractLedger();
  }

  describe('canResume', () => {
    it('returns allowed:false for missing handoff artifact', () => {
      const ledger = makeLedger();
      const gate = new HandoffGate(ledger);
      const result = gate.canResume('nonexistent');
      assert.equal(result.allowed, false);
      assert.ok(result.reason.includes('not found'));
    });

    it('returns allowed:false for incomplete handoff (no summary)', () => {
      const ledger = makeLedger();
      const ha = createHandoffArtifact({
        contractId: 'c-1',
        nextAction: 'Deploy',
      });
      ledger.storeHandoffArtifact(ha);
      const gate = new HandoffGate(ledger);
      const result = gate.canResume('c-1');
      assert.equal(result.allowed, false);
      assert.ok(result.reason.includes('incomplete'));
    });

    it('returns allowed:false for incomplete handoff (no nextAction)', () => {
      const ledger = makeLedger();
      const ha = createHandoffArtifact({
        contractId: 'c-2',
        summary: 'Done',
      });
      ledger.storeHandoffArtifact(ha);
      const gate = new HandoffGate(ledger);
      const result = gate.canResume('c-2');
      assert.equal(result.allowed, false);
      assert.ok(result.reason.includes('incomplete'));
    });

    it('returns allowed:true for complete handoff', () => {
      const ledger = makeLedger();
      const ha = createHandoffArtifact({
        contractId: 'c-3',
        summary: 'All done',
        nextAction: 'Deploy to staging',
        openItems: ['Follow-up task'],
      });
      ledger.storeHandoffArtifact(ha);
      const gate = new HandoffGate(ledger);
      const result = gate.canResume('c-3');
      assert.equal(result.allowed, true);
      assert.equal(result.reason, undefined);
    });
  });
});
