#!/usr/bin/env node
/**
 * Provider Approval Gate Tests — SDK-5
 *
 * Tests ProviderApprovalGate, built-in policies (ScopeBasedPolicy,
 * DenyNetworkPolicy, AllowAllPolicy), and integration with SessionLedger.
 *
 * Run: npm run build && node --test tests/provider-approval-gate.test.mjs
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const {
  ProviderApprovalGate,
  ScopeBasedPolicy,
  DenyNetworkPolicy,
  AllowAllPolicy,
} = await import('../dist/platform/bus/provider-approval-gate.js');

const { InMemorySessionLedger } = await import(
  '../dist/platform/providers/session-ledger.js'
);

const {
  createProviderSessionRecord,
} = await import('../dist/platform/core/harness/provider-session-record.js');

const {
  InMemoryContractLedger,
  createSprintContract,
} = await import('../dist/platform/core/harness/index.js');

// ── Helpers ─────────────────────────────────────────────────────────────

function makeProviderRef(providerSessionId = 'ps-1') {
  return {
    provider: 'codex',
    executionMode: 'cli_exec',
    providerSessionId,
  };
}

function makeApprovalRequest(overrides = {}) {
  return {
    providerRef: makeProviderRef(),
    requestId: 'req-1',
    kind: 'tool',
    reason: 'read_file',
    ...overrides,
  };
}

function makeLedgerWithSession(opts = {}) {
  const ledger = new InMemorySessionLedger();
  const providerRef = makeProviderRef(opts.providerSessionId ?? 'ps-1');
  const record = createProviderSessionRecord({
    quorumSessionId: opts.quorumSessionId ?? 'qs-1',
    providerRef,
    contractId: opts.contractId,
  });
  ledger.upsert(record);
  return { ledger, record, providerRef };
}

// ═══════════════════════════════════════════════════════════════════════
// 1. ProviderApprovalGate — evaluate()
// ═══════════════════════════════════════════════════════════════════════

describe('ProviderApprovalGate — evaluate()', () => {
  it('fail-closed: no policies → deny', () => {
    const { ledger } = makeLedgerWithSession();
    const gate = new ProviderApprovalGate(ledger);

    const result = gate.evaluate(makeApprovalRequest());
    assert.equal(result.decision, 'deny');
    assert.equal(result.decidedBy, 'default');
    assert.ok(result.reason.includes('No policy allowed'));
  });

  it('single AllowAllPolicy → allow', () => {
    const { ledger } = makeLedgerWithSession();
    const gate = new ProviderApprovalGate(ledger);
    gate.addPolicy(new AllowAllPolicy());

    const result = gate.evaluate(makeApprovalRequest());
    assert.equal(result.decision, 'allow');
    assert.equal(result.decidedBy, 'allow-all');
  });

  it('DenyNetworkPolicy denies network requests', () => {
    const { ledger } = makeLedgerWithSession();
    const gate = new ProviderApprovalGate(ledger);
    gate.addPolicy(new DenyNetworkPolicy());

    const result = gate.evaluate(makeApprovalRequest({ kind: 'network', reason: 'fetch api.example.com' }));
    assert.equal(result.decision, 'deny');
    assert.equal(result.decidedBy, 'deny-network');
  });

  it('DenyNetworkPolicy defers non-network requests', () => {
    const { ledger } = makeLedgerWithSession();
    const gate = new ProviderApprovalGate(ledger);
    gate.addPolicy(new DenyNetworkPolicy());

    const result = gate.evaluate(makeApprovalRequest({ kind: 'tool', reason: 'read_file' }));
    // DenyNetworkPolicy defers → fall through to default deny
    assert.equal(result.decision, 'deny');
    assert.equal(result.decidedBy, 'default');
  });

  it('ScopeBasedPolicy allows tools in scope', () => {
    const { ledger } = makeLedgerWithSession({ contractId: 'c-1' });
    const contractLedger = new InMemoryContractLedger();
    contractLedger.storeSprintContract(
      createSprintContract({ contractId: 'c-1', trackName: 't', waveId: 'w', scope: ['read_file', 'write_file'] })
    );

    const gate = new ProviderApprovalGate(ledger, contractLedger);
    gate.addPolicy(new ScopeBasedPolicy());

    const result = gate.evaluate(makeApprovalRequest({ kind: 'tool', reason: 'read_file' }));
    assert.equal(result.decision, 'allow');
    assert.equal(result.decidedBy, 'scope-based');
  });

  it('ScopeBasedPolicy defers tools not in scope', () => {
    const { ledger } = makeLedgerWithSession({ contractId: 'c-1' });
    const contractLedger = new InMemoryContractLedger();
    contractLedger.storeSprintContract(
      createSprintContract({ contractId: 'c-1', trackName: 't', waveId: 'w', scope: ['read_file'] })
    );

    const gate = new ProviderApprovalGate(ledger, contractLedger);
    gate.addPolicy(new ScopeBasedPolicy());

    const result = gate.evaluate(makeApprovalRequest({ kind: 'tool', reason: 'delete_file' }));
    // ScopeBasedPolicy defers (tool not in scope) → default deny
    assert.equal(result.decision, 'deny');
    assert.equal(result.decidedBy, 'default');
  });

  it('policy chain: first non-defer wins', () => {
    const { ledger } = makeLedgerWithSession();
    const gate = new ProviderApprovalGate(ledger);

    // DenyNetworkPolicy denies network, defers everything else
    // AllowAllPolicy allows everything
    gate.addPolicy(new DenyNetworkPolicy());
    gate.addPolicy(new AllowAllPolicy());

    // Network → denied by first policy
    const netResult = gate.evaluate(makeApprovalRequest({ kind: 'network', reason: 'fetch' }));
    assert.equal(netResult.decision, 'deny');
    assert.equal(netResult.decidedBy, 'deny-network');

    // Tool → deferred by first, allowed by second
    const toolResult = gate.evaluate(makeApprovalRequest({ kind: 'tool', reason: 'read_file' }));
    assert.equal(toolResult.decision, 'allow');
    assert.equal(toolResult.decidedBy, 'allow-all');
  });

  it('works without contract ledger (context.allowedTools undefined)', () => {
    const { ledger } = makeLedgerWithSession({ contractId: 'c-1' });
    // No contractLedger provided
    const gate = new ProviderApprovalGate(ledger);
    gate.addPolicy(new ScopeBasedPolicy());

    // ScopeBasedPolicy defers when no allowedTools → default deny
    const result = gate.evaluate(makeApprovalRequest({ kind: 'tool', reason: 'read_file' }));
    assert.equal(result.decision, 'deny');
    assert.equal(result.decidedBy, 'default');
  });

  it('works when session not found in ledger', () => {
    const ledger = new InMemorySessionLedger();
    // No session registered
    const gate = new ProviderApprovalGate(ledger);
    gate.addPolicy(new AllowAllPolicy());

    const result = gate.evaluate(makeApprovalRequest());
    assert.equal(result.decision, 'allow');
    assert.equal(result.decidedBy, 'allow-all');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 2. ProviderApprovalGate — process()
// ═══════════════════════════════════════════════════════════════════════

describe('ProviderApprovalGate — process()', () => {
  it('records approval in session ledger', () => {
    const { ledger, providerRef } = makeLedgerWithSession();
    const gate = new ProviderApprovalGate(ledger);
    gate.addPolicy(new AllowAllPolicy());

    const request = makeApprovalRequest({ providerRef });
    gate.process(request);

    // After process, approval should be resolved (no pending)
    const pending = ledger.pendingApprovals(providerRef.providerSessionId);
    assert.equal(pending.length, 0, 'approval should be resolved after process');
  });

  it('resolves approval with allow decision', () => {
    const { ledger, providerRef } = makeLedgerWithSession();
    const gate = new ProviderApprovalGate(ledger);
    gate.addPolicy(new AllowAllPolicy());

    const request = makeApprovalRequest({ providerRef });
    const decision = gate.process(request);

    assert.equal(decision.requestId, 'req-1');
    assert.equal(decision.decision, 'allow');
  });

  it('resolves approval with deny decision', () => {
    const { ledger, providerRef } = makeLedgerWithSession();
    const gate = new ProviderApprovalGate(ledger);
    // No policies → fail-closed deny

    const request = makeApprovalRequest({ providerRef });
    const decision = gate.process(request);

    assert.equal(decision.requestId, 'req-1');
    assert.equal(decision.decision, 'deny');
  });

  it('updates session state to waiting_approval then running on allow', () => {
    const { ledger, providerRef } = makeLedgerWithSession();
    const gate = new ProviderApprovalGate(ledger);
    gate.addPolicy(new AllowAllPolicy());

    const request = makeApprovalRequest({ providerRef });
    gate.process(request);

    // After allow, state should be restored to 'running'
    const record = ledger.findByProviderSession(providerRef.providerSessionId);
    assert.equal(record.state, 'running');
  });

  it('updates session state to failed on deny', () => {
    const { ledger, providerRef } = makeLedgerWithSession();
    const gate = new ProviderApprovalGate(ledger);
    // No policies → fail-closed deny

    const request = makeApprovalRequest({ providerRef });
    gate.process(request);

    // After deny, state should be 'failed'
    const record = ledger.findByProviderSession(providerRef.providerSessionId);
    assert.equal(record.state, 'failed');
  });

  it('works when session not found in ledger (no state update)', () => {
    const ledger = new InMemorySessionLedger();
    const gate = new ProviderApprovalGate(ledger);
    gate.addPolicy(new AllowAllPolicy());

    // No session registered — should not throw
    const request = makeApprovalRequest();
    const decision = gate.process(request);
    assert.equal(decision.decision, 'allow');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 3. Built-in policies
// ═══════════════════════════════════════════════════════════════════════

describe('Built-in policies', () => {
  describe('ScopeBasedPolicy', () => {
    const policy = new ScopeBasedPolicy();

    it('defers non-tool requests', () => {
      const result = policy.evaluate(
        makeApprovalRequest({ kind: 'command', reason: 'ls' }),
        { allowedTools: ['ls'] }
      );
      assert.equal(result, 'defer');
    });

    it('defers when no allowedTools in context', () => {
      const result = policy.evaluate(
        makeApprovalRequest({ kind: 'tool', reason: 'read_file' }),
        {}
      );
      assert.equal(result, 'defer');
    });

    it('allows tool in scope', () => {
      const result = policy.evaluate(
        makeApprovalRequest({ kind: 'tool', reason: 'read_file' }),
        { allowedTools: ['read_file', 'write_file'] }
      );
      assert.equal(result, 'allow');
    });

    it('defers tool not in scope', () => {
      const result = policy.evaluate(
        makeApprovalRequest({ kind: 'tool', reason: 'delete_file' }),
        { allowedTools: ['read_file', 'write_file'] }
      );
      assert.equal(result, 'defer');
    });
  });

  describe('DenyNetworkPolicy', () => {
    const policy = new DenyNetworkPolicy();

    it('denies network requests', () => {
      const result = policy.evaluate(
        makeApprovalRequest({ kind: 'network', reason: 'fetch api.example.com' }),
        {}
      );
      assert.equal(result, 'deny');
    });

    it('defers tool requests', () => {
      const result = policy.evaluate(
        makeApprovalRequest({ kind: 'tool', reason: 'read_file' }),
        {}
      );
      assert.equal(result, 'defer');
    });

    it('defers command requests', () => {
      const result = policy.evaluate(
        makeApprovalRequest({ kind: 'command', reason: 'ls' }),
        {}
      );
      assert.equal(result, 'defer');
    });

    it('defers diff requests', () => {
      const result = policy.evaluate(
        makeApprovalRequest({ kind: 'diff', reason: 'patch a.ts' }),
        {}
      );
      assert.equal(result, 'defer');
    });
  });

  describe('AllowAllPolicy', () => {
    const policy = new AllowAllPolicy();

    it('allows tool requests', () => {
      const result = policy.evaluate(
        makeApprovalRequest({ kind: 'tool', reason: 'read_file' }),
        {}
      );
      assert.equal(result, 'allow');
    });

    it('allows network requests', () => {
      const result = policy.evaluate(
        makeApprovalRequest({ kind: 'network', reason: 'fetch' }),
        {}
      );
      assert.equal(result, 'allow');
    });

    it('allows command requests', () => {
      const result = policy.evaluate(
        makeApprovalRequest({ kind: 'command', reason: 'ls' }),
        {}
      );
      assert.equal(result, 'allow');
    });

    it('allows diff requests', () => {
      const result = policy.evaluate(
        makeApprovalRequest({ kind: 'diff', reason: 'patch' }),
        {}
      );
      assert.equal(result, 'allow');
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 4. Integration with SessionLedger
// ═══════════════════════════════════════════════════════════════════════

describe('Integration with SessionLedger', () => {
  it('pendingApprovals after recordApproval, resolved after process', () => {
    const { ledger, providerRef } = makeLedgerWithSession();
    const gate = new ProviderApprovalGate(ledger);
    gate.addPolicy(new AllowAllPolicy());

    // Manually record an approval to check pending state
    ledger.recordApproval({
      providerRef,
      requestId: 'manual-req-1',
      kind: 'tool',
      reason: 'read_file',
      requestedAt: Date.now(),
    });

    const pending = ledger.pendingApprovals(providerRef.providerSessionId);
    assert.equal(pending.length, 1);
    assert.equal(pending[0].requestId, 'manual-req-1');

    // Now process a different request through the gate
    const request = makeApprovalRequest({ providerRef, requestId: 'gate-req-1' });
    gate.process(request);

    // The gate-processed request should be resolved
    const pendingAfter = ledger.pendingApprovals(providerRef.providerSessionId);
    // Only the manually-added one remains pending
    assert.equal(pendingAfter.length, 1);
    assert.equal(pendingAfter[0].requestId, 'manual-req-1');
  });

  it('full lifecycle: register session → process approval → verify state', () => {
    const contractLedger = new InMemoryContractLedger();
    contractLedger.storeSprintContract(
      createSprintContract({
        contractId: 'c-full',
        trackName: 't',
        waveId: 'w',
        scope: ['read_file', 'write_file'],
      })
    );

    const { ledger, providerRef } = makeLedgerWithSession({
      contractId: 'c-full',
      quorumSessionId: 'qs-full',
    });

    const gate = new ProviderApprovalGate(ledger, contractLedger);
    gate.addPolicy(new ScopeBasedPolicy());
    gate.addPolicy(new DenyNetworkPolicy());

    // Tool in scope → allow
    const toolDecision = gate.process(
      makeApprovalRequest({ providerRef, requestId: 'r-1', kind: 'tool', reason: 'read_file' })
    );
    assert.equal(toolDecision.decision, 'allow');
    assert.equal(ledger.findByQuorumSession('qs-full').state, 'running');

    // Network → deny
    const netDecision = gate.process(
      makeApprovalRequest({ providerRef, requestId: 'r-2', kind: 'network', reason: 'fetch api.com' })
    );
    assert.equal(netDecision.decision, 'deny');
    assert.equal(ledger.findByQuorumSession('qs-full').state, 'failed');
  });
});
