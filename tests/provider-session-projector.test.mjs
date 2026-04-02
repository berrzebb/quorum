#!/usr/bin/env node
/**
 * Provider Session Projector Tests — SDK-15
 *
 * Tests ProviderSessionProjector: projection of provider session state
 * into bus-readable format for daemon/TUI observability.
 *
 * Run: npm run build && node --test tests/provider-session-projector.test.mjs
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const { ProviderSessionProjector } = await import(
  '../dist/platform/bus/provider-session-projector.js'
);

const { InMemorySessionLedger } = await import(
  '../dist/platform/providers/session-ledger.js'
);

const { createProviderSessionRecord } = await import(
  '../dist/platform/core/harness/provider-session-record.js'
);

// ── Helpers ─────────────────────────────────────────────────────────────

function makeProviderRef(overrides = {}) {
  return {
    provider: 'codex',
    executionMode: 'cli_exec',
    providerSessionId: 'ps-1',
    ...overrides,
  };
}

function makeLedgerWithSession(opts = {}) {
  const ledger = new InMemorySessionLedger();
  const providerRef = makeProviderRef({
    providerSessionId: opts.providerSessionId ?? 'ps-1',
    provider: opts.provider ?? 'codex',
    executionMode: opts.executionMode ?? 'cli_exec',
    threadId: opts.threadId,
  });
  const now = Date.now();
  const record = createProviderSessionRecord({
    quorumSessionId: opts.quorumSessionId ?? 'qs-1',
    providerRef,
    contractId: opts.contractId,
    startedAt: opts.startedAt ?? now - 5000,
    updatedAt: opts.updatedAt ?? now - 1000,
    state: opts.state ?? 'running',
  });
  ledger.upsert(record);
  return { ledger, record, providerRef };
}

// ═══════════════════════════════════════════════════════════════════════
// 1. project() — single session projection
// ═══════════════════════════════════════════════════════════════════════

describe('ProviderSessionProjector — project()', () => {
  it('returns null for unknown session', () => {
    const ledger = new InMemorySessionLedger();
    const projector = new ProviderSessionProjector(ledger);

    const result = projector.project('nonexistent-session');
    assert.equal(result, null);
  });

  it('returns correct shape for known session', () => {
    const { ledger } = makeLedgerWithSession({
      quorumSessionId: 'qs-shape',
      provider: 'claude',
      executionMode: 'agent_sdk',
    });
    const projector = new ProviderSessionProjector(ledger);

    const result = projector.project('qs-shape');
    assert.notEqual(result, null);
    assert.equal(result.quorumSessionId, 'qs-shape');
    assert.equal(result.provider, 'claude');
    assert.equal(result.executionMode, 'agent_sdk');
    assert.equal(result.providerSessionId, 'ps-1');
    assert.equal(result.state, 'running');
    assert.equal(typeof result.startedAt, 'number');
    assert.equal(typeof result.updatedAt, 'number');
    assert.equal(typeof result.age, 'number');
    assert.equal(typeof result.pendingApprovals, 'number');
  });

  it('calculates age correctly', () => {
    const startedAt = Date.now() - 10_000; // 10 seconds ago
    const { ledger } = makeLedgerWithSession({
      quorumSessionId: 'qs-age',
      startedAt,
    });
    const projector = new ProviderSessionProjector(ledger);

    const result = projector.project('qs-age');
    assert.notEqual(result, null);
    // Age should be >= 10000ms (started 10s ago)
    assert.ok(result.age >= 10_000, `age ${result.age} should be >= 10000`);
    // Age should be reasonable (< 60s given test execution time)
    assert.ok(result.age < 60_000, `age ${result.age} should be < 60000`);
  });

  it('counts pending approvals', () => {
    const { ledger, providerRef } = makeLedgerWithSession({
      quorumSessionId: 'qs-approvals',
    });

    // Add some pending approvals
    ledger.recordApproval({
      providerRef,
      requestId: 'req-a',
      kind: 'tool',
      reason: 'read_file',
      requestedAt: Date.now(),
    });
    ledger.recordApproval({
      providerRef,
      requestId: 'req-b',
      kind: 'command',
      reason: 'ls',
      requestedAt: Date.now(),
    });
    // Resolve one of them
    ledger.resolveApproval('req-a', 'allow');

    const projector = new ProviderSessionProjector(ledger);
    const result = projector.project('qs-approvals');

    assert.notEqual(result, null);
    assert.equal(result.pendingApprovals, 1, 'should have 1 pending approval (1 resolved)');
  });

  it('includes threadId when present', () => {
    const { ledger } = makeLedgerWithSession({
      quorumSessionId: 'qs-thread',
      threadId: 'thread-xyz',
    });
    const projector = new ProviderSessionProjector(ledger);

    const result = projector.project('qs-thread');
    assert.notEqual(result, null);
    assert.equal(result.threadId, 'thread-xyz');
  });

  it('threadId is undefined when not present', () => {
    const { ledger } = makeLedgerWithSession({
      quorumSessionId: 'qs-no-thread',
    });
    const projector = new ProviderSessionProjector(ledger);

    const result = projector.project('qs-no-thread');
    assert.notEqual(result, null);
    assert.equal(result.threadId, undefined);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 2. projectByContract() — contract-based projection
// ═══════════════════════════════════════════════════════════════════════

describe('ProviderSessionProjector — projectByContract()', () => {
  it('returns empty for unknown contract', () => {
    const ledger = new InMemorySessionLedger();
    const projector = new ProviderSessionProjector(ledger);

    const result = projector.projectByContract('nonexistent-contract');
    assert.deepEqual(result, []);
  });

  it('returns sessions for known contract', () => {
    const ledger = new InMemorySessionLedger();

    // Two sessions bound to the same contract
    const ref1 = makeProviderRef({ providerSessionId: 'ps-c1' });
    ledger.upsert(createProviderSessionRecord({
      quorumSessionId: 'qs-c1',
      providerRef: ref1,
      contractId: 'contract-alpha',
    }));

    const ref2 = makeProviderRef({ providerSessionId: 'ps-c2', provider: 'claude' });
    ledger.upsert(createProviderSessionRecord({
      quorumSessionId: 'qs-c2',
      providerRef: ref2,
      contractId: 'contract-alpha',
    }));

    // One session bound to a different contract
    const ref3 = makeProviderRef({ providerSessionId: 'ps-c3' });
    ledger.upsert(createProviderSessionRecord({
      quorumSessionId: 'qs-c3',
      providerRef: ref3,
      contractId: 'contract-beta',
    }));

    const projector = new ProviderSessionProjector(ledger);
    const result = projector.projectByContract('contract-alpha');

    assert.equal(result.length, 2);
    const ids = result.map((p) => p.quorumSessionId).sort();
    assert.deepEqual(ids, ['qs-c1', 'qs-c2']);
  });

  it('includes pending approval count in contract projections', () => {
    const ledger = new InMemorySessionLedger();
    const ref = makeProviderRef({ providerSessionId: 'ps-contract-appr' });
    ledger.upsert(createProviderSessionRecord({
      quorumSessionId: 'qs-contract-appr',
      providerRef: ref,
      contractId: 'contract-gamma',
    }));

    // Add 3 pending approvals
    for (let i = 0; i < 3; i++) {
      ledger.recordApproval({
        providerRef: ref,
        requestId: `req-${i}`,
        kind: 'tool',
        reason: `tool-${i}`,
        requestedAt: Date.now(),
      });
    }

    const projector = new ProviderSessionProjector(ledger);
    const result = projector.projectByContract('contract-gamma');

    assert.equal(result.length, 1);
    assert.equal(result[0].pendingApprovals, 3);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 3. projectAll() — list all sessions
// ═══════════════════════════════════════════════════════════════════════

describe('ProviderSessionProjector — projectAll()', () => {
  it('returns empty array (InMemorySessionLedger has no listAll)', () => {
    const ledger = new InMemorySessionLedger();
    ledger.upsert(createProviderSessionRecord({
      quorumSessionId: 'qs-all-1',
      providerRef: makeProviderRef(),
    }));

    const projector = new ProviderSessionProjector(ledger);
    const result = projector.projectAll();

    assert.deepEqual(result, []);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 4. SessionProjection — field completeness
// ═══════════════════════════════════════════════════════════════════════

describe('SessionProjection — field completeness', () => {
  it('has all required fields', () => {
    const { ledger } = makeLedgerWithSession({
      quorumSessionId: 'qs-fields',
      provider: 'codex',
      executionMode: 'cli_exec',
    });
    const projector = new ProviderSessionProjector(ledger);

    const result = projector.project('qs-fields');
    assert.notEqual(result, null);

    const requiredFields = [
      'quorumSessionId',
      'provider',
      'executionMode',
      'providerSessionId',
      'state',
      'startedAt',
      'updatedAt',
      'age',
      'pendingApprovals',
    ];

    for (const field of requiredFields) {
      assert.ok(
        field in result,
        `SessionProjection should have field '${field}'`
      );
      assert.notEqual(
        result[field],
        undefined,
        `SessionProjection.${field} should not be undefined`
      );
    }
  });

  it('reflects session state changes', () => {
    const { ledger } = makeLedgerWithSession({
      quorumSessionId: 'qs-state-change',
      state: 'running',
    });
    const projector = new ProviderSessionProjector(ledger);

    // Initially running
    let result = projector.project('qs-state-change');
    assert.equal(result.state, 'running');

    // Update to waiting_approval
    ledger.updateState('qs-state-change', 'waiting_approval');
    result = projector.project('qs-state-change');
    assert.equal(result.state, 'waiting_approval');

    // Update to completed
    ledger.updateState('qs-state-change', 'completed');
    result = projector.project('qs-state-change');
    assert.equal(result.state, 'completed');
  });
});
