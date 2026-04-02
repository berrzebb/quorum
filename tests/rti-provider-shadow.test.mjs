#!/usr/bin/env node
/**
 * RTI-2C: Provider Runtime Shadow Plumbing + Replay Contract Tests
 *
 * Verifies that:
 * 1. Both Claude SDK and Codex providers pass through the same classifier/gate chain
 * 2. Shadow classifier results are recorded alongside gate decisions
 * 3. Telemetry records can be replayed through the classifier with same results
 * 4. Gate behavior is UNCHANGED by shadow classifier (invariant)
 *
 * Run: node --test tests/rti-provider-shadow.test.mjs
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

const {
  ProviderApprovalGate,
  AllowAllPolicy,
  DenyNetworkPolicy,
} = await import("../dist/platform/bus/provider-approval-gate.js");
const { InMemorySessionLedger } = await import(
  "../dist/platform/providers/session-ledger.js"
);
const {
  classify,
  telemetryToInput,
  validateSafetyInvariant,
} = await import("../dist/platform/bus/approval-classifier.js");

function makeRef(provider, sessionId) {
  return {
    provider,
    executionMode: provider === "codex" ? "cli_exec" : "agent_sdk",
    providerSessionId: sessionId,
  };
}

function registerSession(ledger, ref) {
  ledger.upsert({
    quorumSessionId: `q-${ref.providerSessionId}`,
    providerRef: ref,
    startedAt: Date.now(),
    updatedAt: Date.now(),
    state: "running",
  });
}

// ═══ 1. Provider Parity ═════════════════════════════════════════════════

describe("RTI-2C: Both providers see same classifier chain", () => {
  let ledger;
  let gate;

  beforeEach(() => {
    ledger = new InMemorySessionLedger();
    gate = new ProviderApprovalGate(ledger);
    gate.addPolicy(new AllowAllPolicy());
  });

  it("Claude SDK and Codex produce telemetry with classifier decision", () => {
    const claudeRef = makeRef("claude", "claude-s1");
    const codexRef = makeRef("codex", "codex-s1");
    registerSession(ledger, claudeRef);
    registerSession(ledger, codexRef);

    const records = [];
    gate.onTelemetry((r) => records.push(r));

    gate.process({ providerRef: claudeRef, requestId: "r1", kind: "tool", reason: "code_map" });
    gate.process({ providerRef: codexRef, requestId: "r2", kind: "tool", reason: "code_map" });

    assert.equal(records.length, 2);
    // Both should have classifier decisions
    assert.ok(records[0].classifierDecision, "Claude should have classifier");
    assert.ok(records[1].classifierDecision, "Codex should have classifier");
    // Same tool → same classification
    assert.equal(records[0].classifierDecision.bucket, records[1].classifierDecision.bucket);
  });

  it("shadow callbacks fire for both providers", () => {
    const claudeRef = makeRef("claude", "claude-s2");
    const codexRef = makeRef("codex", "codex-s2");
    registerSession(ledger, claudeRef);
    registerSession(ledger, codexRef);

    const shadows = [];
    gate.onShadowClassifier((input, decision, gateDecision) => {
      shadows.push({ input, decision, gateDecision });
    });

    gate.process({ providerRef: claudeRef, requestId: "r3", kind: "tool", reason: "blast_radius" });
    gate.process({ providerRef: codexRef, requestId: "r4", kind: "network", reason: "fetch api" });

    assert.equal(shadows.length, 2);
    // First: tool request → auto-allow bucket
    assert.equal(shadows[0].input.tool, "blast_radius");
    assert.equal(shadows[0].gateDecision, "allow");
    // Second: network request → needs-human bucket
    assert.equal(shadows[1].input.tool, "fetch api");
    assert.equal(shadows[1].input.network, true);
  });
});

// ═══ 2. Shadow Does Not Change Gate Behavior ════════════════════════════

describe("RTI-2C: Shadow invariant — gate behavior unchanged", () => {
  it("gate with AllowAll → allow regardless of classifier bucket", () => {
    const ledger = new InMemorySessionLedger();
    const gate = new ProviderApprovalGate(ledger);
    gate.addPolicy(new AllowAllPolicy());

    const ref = makeRef("claude", "inv-s1");
    registerSession(ledger, ref);

    // Classifier would say "needs-human" for network, but gate still allows
    const decision = gate.process({ providerRef: ref, requestId: "r5", kind: "network", reason: "curl" });
    assert.equal(decision.decision, "allow");
  });

  it("gate with no policies → deny regardless of classifier auto-allow", () => {
    const ledger = new InMemorySessionLedger();
    const gate = new ProviderApprovalGate(ledger);
    // No policies → fail-closed

    const ref = makeRef("codex", "inv-s2");
    registerSession(ledger, ref);

    // Classifier would say "auto-allow" for read-only, but gate denies
    const decision = gate.process({ providerRef: ref, requestId: "r6", kind: "tool", reason: "code_map" });
    assert.equal(decision.decision, "deny");
  });

  it("gate with DenyNetwork → network denied even if classifier disagrees", () => {
    const ledger = new InMemorySessionLedger();
    const gate = new ProviderApprovalGate(ledger);
    gate.addPolicy(new DenyNetworkPolicy());

    const ref = makeRef("claude", "inv-s3");
    registerSession(ledger, ref);

    const decision = gate.process({ providerRef: ref, requestId: "r7", kind: "network", reason: "api call" });
    assert.equal(decision.decision, "deny");
  });
});

// ═══ 3. Replay Contract ═════════════════════════════════════════════════

describe("RTI-2C: Replay contract — telemetry → classifier → same result", () => {
  it("replaying telemetry produces same classification", () => {
    const ledger = new InMemorySessionLedger();
    const gate = new ProviderApprovalGate(ledger);
    gate.addPolicy(new AllowAllPolicy());

    const ref = makeRef("claude", "replay-s1");
    registerSession(ledger, ref);

    const records = [];
    gate.onTelemetry((r) => records.push(r));

    gate.process({ providerRef: ref, requestId: "r8", kind: "tool", reason: "code_map" });
    gate.process({ providerRef: ref, requestId: "r9", kind: "tool", reason: "dangerous_op" });

    for (const record of records) {
      const input = telemetryToInput(record);
      const replayed = classify(input);

      // Replayed classification should match recorded classification
      if (record.classifierDecision) {
        assert.equal(
          replayed.bucket,
          record.classifierDecision.bucket,
          `Replay mismatch for tool="${record.tool}"`,
        );
      }

      // Safety invariant must hold on replay
      assert.ok(
        validateSafetyInvariant(input, replayed),
        `Safety invariant violated on replay for tool="${record.tool}"`,
      );
    }
  });

  it("replaying destructive tool preserves auto-deny", () => {
    const record = {
      ts: Date.now(),
      provider: "codex",
      sessionId: "s1",
      tool: "rm_recursive",
      kind: "command",
      readOnly: false,
      destructive: true,
      network: false,
      diff: false,
      decision: "deny",
      decidedBy: "default",
      reason: "test",
    };

    const input = telemetryToInput(record);
    const replayed = classify(input);
    assert.equal(replayed.bucket, "auto-deny");
    assert.ok(validateSafetyInvariant(input, replayed));
  });
});
