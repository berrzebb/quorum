#!/usr/bin/env node
/**
 * Provider Session Ledger Tests — SDK-4
 *
 * Tests ProviderSessionRecord, ProviderApprovalRecord factories,
 * and InMemorySessionLedger implementation.
 *
 * Run: npm run build && node --test tests/session-ledger.test.mjs
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

// Import from compiled dist (platform/**/*.ts → dist/platform/**)
const {
  createProviderSessionRecord,
  createProviderApprovalRecord,
} = await import('../dist/platform/core/harness/provider-session-record.js');

const { InMemorySessionLedger } = await import(
  '../dist/platform/providers/session-ledger.js'
);

// ── Helper: build a ProviderSessionRef ──────────────────────────────

function makeRef(id = 'provider-session-1') {
  return {
    provider: 'codex',
    executionMode: 'cli_exec',
    providerSessionId: id,
  };
}

// ═══ 1. createProviderSessionRecord ═════════════════════════════════

describe('createProviderSessionRecord', () => {
  it('creates with defaults (state=running, timestamps set)', () => {
    const before = Date.now();
    const record = createProviderSessionRecord({
      quorumSessionId: 'qs-1',
      providerRef: makeRef(),
    });
    const after = Date.now();

    assert.equal(record.quorumSessionId, 'qs-1');
    assert.equal(record.state, 'running');
    assert.equal(record.contractId, undefined);
    assert.ok(record.startedAt >= before && record.startedAt <= after);
    assert.ok(record.updatedAt >= before && record.updatedAt <= after);
    assert.deepEqual(record.providerRef, makeRef());
  });

  it('accepts overrides for all fields', () => {
    const record = createProviderSessionRecord({
      quorumSessionId: 'qs-2',
      providerRef: makeRef('ps-2'),
      contractId: 'contract-42',
      startedAt: 1000,
      updatedAt: 2000,
      state: 'completed',
    });

    assert.equal(record.contractId, 'contract-42');
    assert.equal(record.startedAt, 1000);
    assert.equal(record.updatedAt, 2000);
    assert.equal(record.state, 'completed');
  });
});

// ═══ 2. createProviderApprovalRecord ════════════════════════════════

describe('createProviderApprovalRecord', () => {
  it('creates with defaults (requestedAt set, no decision)', () => {
    const before = Date.now();
    const record = createProviderApprovalRecord({
      providerRef: makeRef(),
      requestId: 'req-1',
      kind: 'tool',
      reason: 'wants to run npm test',
    });
    const after = Date.now();

    assert.equal(record.requestId, 'req-1');
    assert.equal(record.kind, 'tool');
    assert.equal(record.reason, 'wants to run npm test');
    assert.equal(record.decision, undefined);
    assert.equal(record.decidedAt, undefined);
    assert.ok(record.requestedAt >= before && record.requestedAt <= after);
  });

  it('accepts overrides for decision and decidedAt', () => {
    const record = createProviderApprovalRecord({
      providerRef: makeRef(),
      requestId: 'req-2',
      kind: 'command',
      reason: 'run shell',
      decision: 'allow',
      decidedAt: 5000,
      requestedAt: 4000,
    });

    assert.equal(record.decision, 'allow');
    assert.equal(record.decidedAt, 5000);
    assert.equal(record.requestedAt, 4000);
  });
});

// ═══ 3. InMemorySessionLedger ═══════════════════════════════════════

describe('InMemorySessionLedger', () => {
  it('upsert and findByQuorumSession', () => {
    const ledger = new InMemorySessionLedger();
    const record = createProviderSessionRecord({
      quorumSessionId: 'qs-1',
      providerRef: makeRef('ps-1'),
    });

    ledger.upsert(record);
    const found = ledger.findByQuorumSession('qs-1');
    assert.ok(found);
    assert.equal(found.quorumSessionId, 'qs-1');
    assert.equal(found.providerRef.providerSessionId, 'ps-1');
  });

  it('findByQuorumSession returns undefined for unknown id', () => {
    const ledger = new InMemorySessionLedger();
    assert.equal(ledger.findByQuorumSession('nonexistent'), undefined);
  });

  it('findByProviderSession', () => {
    const ledger = new InMemorySessionLedger();
    const record = createProviderSessionRecord({
      quorumSessionId: 'qs-2',
      providerRef: makeRef('ps-2'),
    });

    ledger.upsert(record);
    const found = ledger.findByProviderSession('ps-2');
    assert.ok(found);
    assert.equal(found.quorumSessionId, 'qs-2');
  });

  it('findByProviderSession returns undefined for unknown id', () => {
    const ledger = new InMemorySessionLedger();
    assert.equal(ledger.findByProviderSession('nonexistent'), undefined);
  });

  it('findByContract with multiple records', () => {
    const ledger = new InMemorySessionLedger();

    ledger.upsert(createProviderSessionRecord({
      quorumSessionId: 'qs-a',
      providerRef: makeRef('ps-a'),
      contractId: 'contract-1',
    }));
    ledger.upsert(createProviderSessionRecord({
      quorumSessionId: 'qs-b',
      providerRef: makeRef('ps-b'),
      contractId: 'contract-1',
    }));
    ledger.upsert(createProviderSessionRecord({
      quorumSessionId: 'qs-c',
      providerRef: makeRef('ps-c'),
      contractId: 'contract-2',
    }));

    const results = ledger.findByContract('contract-1');
    assert.equal(results.length, 2);
    const ids = results.map((r) => r.quorumSessionId).sort();
    assert.deepEqual(ids, ['qs-a', 'qs-b']);
  });

  it('findByContract returns empty array when none match', () => {
    const ledger = new InMemorySessionLedger();
    ledger.upsert(createProviderSessionRecord({
      quorumSessionId: 'qs-x',
      providerRef: makeRef('ps-x'),
      contractId: 'other',
    }));

    const results = ledger.findByContract('nonexistent');
    assert.deepEqual(results, []);
  });

  it('updateState changes state and updatedAt', () => {
    const ledger = new InMemorySessionLedger();
    const record = createProviderSessionRecord({
      quorumSessionId: 'qs-3',
      providerRef: makeRef('ps-3'),
    });

    ledger.upsert(record);
    const before = record.updatedAt;

    // Small delay to ensure timestamp differs
    const originalNow = Date.now;
    let callCount = 0;
    Date.now = () => {
      callCount++;
      return before + 100;
    };

    ledger.updateState('qs-3', 'completed');

    Date.now = originalNow;

    const found = ledger.findByQuorumSession('qs-3');
    assert.ok(found);
    assert.equal(found.state, 'completed');
    assert.ok(found.updatedAt >= before, 'updatedAt should be >= before');
  });

  it('updateState is a no-op for unknown session', () => {
    const ledger = new InMemorySessionLedger();
    // Should not throw
    ledger.updateState('nonexistent', 'failed');
    assert.ok(true);
  });

  it('recordApproval and pendingApprovals', () => {
    const ledger = new InMemorySessionLedger();
    const ref = makeRef('ps-4');

    ledger.recordApproval(createProviderApprovalRecord({
      providerRef: ref,
      requestId: 'req-a',
      kind: 'tool',
      reason: 'wants bash',
    }));
    ledger.recordApproval(createProviderApprovalRecord({
      providerRef: ref,
      requestId: 'req-b',
      kind: 'diff',
      reason: 'wants to write file',
    }));

    const pending = ledger.pendingApprovals('ps-4');
    assert.equal(pending.length, 2);
    const ids = pending.map((p) => p.requestId).sort();
    assert.deepEqual(ids, ['req-a', 'req-b']);
  });

  it('resolveApproval sets decision and decidedAt', () => {
    const ledger = new InMemorySessionLedger();
    const ref = makeRef('ps-5');

    ledger.recordApproval(createProviderApprovalRecord({
      providerRef: ref,
      requestId: 'req-c',
      kind: 'command',
      reason: 'run tests',
    }));

    ledger.resolveApproval('req-c', 'allow');

    const pending = ledger.pendingApprovals('ps-5');
    assert.equal(pending.length, 0, 'resolved approval should not be pending');
  });

  it('pendingApprovals excludes resolved approvals', () => {
    const ledger = new InMemorySessionLedger();
    const ref = makeRef('ps-6');

    ledger.recordApproval(createProviderApprovalRecord({
      providerRef: ref,
      requestId: 'req-d',
      kind: 'tool',
      reason: 'tool access',
    }));
    ledger.recordApproval(createProviderApprovalRecord({
      providerRef: ref,
      requestId: 'req-e',
      kind: 'network',
      reason: 'network access',
    }));

    // Resolve one
    ledger.resolveApproval('req-d', 'deny');

    const pending = ledger.pendingApprovals('ps-6');
    assert.equal(pending.length, 1);
    assert.equal(pending[0].requestId, 'req-e');
  });

  it('pendingApprovals returns empty for unknown provider session', () => {
    const ledger = new InMemorySessionLedger();
    const pending = ledger.pendingApprovals('nonexistent');
    assert.deepEqual(pending, []);
  });

  it('upsert updates existing record (same quorumSessionId)', () => {
    const ledger = new InMemorySessionLedger();
    const record = createProviderSessionRecord({
      quorumSessionId: 'qs-dup',
      providerRef: makeRef('ps-dup'),
      contractId: 'c-1',
    });

    ledger.upsert(record);
    assert.equal(ledger.findByQuorumSession('qs-dup')?.contractId, 'c-1');

    // Update with new contractId
    record.contractId = 'c-2';
    ledger.upsert(record);
    assert.equal(ledger.findByQuorumSession('qs-dup')?.contractId, 'c-2');
  });
});
