#!/usr/bin/env node
/**
 * RTI Phase 0: Baseline Telemetry Tests
 *
 * RTI-1A: Approval telemetry — replay-compatible records
 * RTI-1B: Compact + gate profile telemetry
 * RTI-1C: Transcript workload telemetry hooks
 *
 * Run: node --test tests/rti-telemetry.test.mjs
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
  onCompactTelemetry,
  generateCompactSummary,
  generateFallbackSummary,
  formatCompactContext,
} = await import("../dist/platform/orchestrate/execution/wave-compact.js");
const {
  selectGateProfileWithTelemetry,
  onGateProfileTelemetry,
  FULL_PROFILE,
  STANDARD_PROFILE,
  MINIMAL_PROFILE,
} = await import("../dist/platform/orchestrate/governance/adaptive-gate-profile.js");
const {
  emitTranscriptWorkload,
  onTranscriptWorkload,
} = await import("../dist/platform/bus/provider-session-projector.js");

// ═══ RTI-1A: Approval Telemetry ═════════════════════════════════════════

describe("RTI-1A: Approval telemetry", () => {
  let ledger;
  let gate;
  const sessionRef = {
    provider: "claude",
    executionMode: "agent_sdk",
    providerSessionId: "telem-session-1",
  };

  beforeEach(() => {
    ledger = new InMemorySessionLedger();
    gate = new ProviderApprovalGate(ledger);
    ledger.upsert({
      quorumSessionId: "q-telem-1",
      providerRef: sessionRef,
      startedAt: Date.now(),
      updatedAt: Date.now(),
      state: "running",
    });
  });

  it("emits telemetry record on process()", () => {
    const records = [];
    gate.onTelemetry((r) => records.push(r));
    gate.addPolicy(new AllowAllPolicy());

    gate.process({
      providerRef: sessionRef,
      requestId: "req-1",
      kind: "tool",
      reason: "code_map",
    });

    assert.equal(records.length, 1);
    const r = records[0];
    assert.equal(r.provider, "claude");
    assert.equal(r.sessionId, "telem-session-1");
    assert.equal(r.tool, "code_map");
    assert.equal(r.kind, "tool");
    assert.equal(r.decision, "allow");
    assert.equal(r.decidedBy, "allow-all");
    assert.equal(typeof r.ts, "number");
  });

  it("captures deny decisions", () => {
    const records = [];
    gate.onTelemetry((r) => records.push(r));
    // No policies → fail-closed → deny

    gate.process({
      providerRef: sessionRef,
      requestId: "req-2",
      kind: "command",
      reason: "rm -rf /",
    });

    assert.equal(records.length, 1);
    assert.equal(records[0].decision, "deny");
    assert.equal(records[0].kind, "command");
  });

  it("captures network kind", () => {
    const records = [];
    gate.onTelemetry((r) => records.push(r));
    gate.addPolicy(new DenyNetworkPolicy());

    gate.process({
      providerRef: sessionRef,
      requestId: "req-3",
      kind: "network",
      reason: "fetch https://api.example.com",
    });

    assert.equal(records[0].network, true);
    assert.equal(records[0].decision, "deny");
  });

  it("telemetry callback errors do not break gate", () => {
    gate.onTelemetry(() => { throw new Error("boom"); });
    gate.addPolicy(new AllowAllPolicy());

    // Should not throw
    const decision = gate.process({
      providerRef: sessionRef,
      requestId: "req-4",
      kind: "tool",
      reason: "code_map",
    });
    assert.equal(decision.decision, "allow");
  });

  it("no telemetry emitted when no callbacks registered", () => {
    gate.addPolicy(new AllowAllPolicy());
    // Should work fine with no callbacks
    const decision = gate.process({
      providerRef: sessionRef,
      requestId: "req-5",
      kind: "tool",
      reason: "code_map",
    });
    assert.equal(decision.decision, "allow");
  });
});

// ═══ RTI-1B: Compact Telemetry ══════════════════════════════════════════

describe("RTI-1B: Compact telemetry", () => {
  it("onCompactTelemetry is callable", () => {
    assert.equal(typeof onCompactTelemetry, "function");
  });

  it("generates deterministic compact without telemetry error", () => {
    const summary = generateCompactSummary({
      waveIndex: 1,
      trackName: "test-track",
      changedFiles: ["src/a.ts"],
      fitness: 0.85,
      findings: [{ code: "type-safety", severity: "medium", summary: "missing type" }],
      waveFiles: ["src/a.ts", "src/b.ts"],
    });
    assert.equal(summary.source, "generated");
    assert.equal(summary.waveIndex, 1);
  });

  it("generates fallback compact", () => {
    const summary = generateFallbackSummary(2, "track-b", ["file.ts"], 0.7);
    assert.equal(summary.source, "fallback");
    assert.equal(summary.waveIndex, 2);
  });
});

describe("RTI-1B: Gate profile telemetry", () => {
  it("selectGateProfileWithTelemetry emits telemetry", () => {
    const records = [];
    onGateProfileTelemetry((r) => records.push(r));

    const profile = selectGateProfileWithTelemetry(["security"]);
    assert.equal(profile.profileId, "full");
    assert.ok(records.length >= 1);
    const r = records[records.length - 1];
    assert.equal(r.profileId, "full");
    assert.ok(r.inputTriggers.includes("security"));
    assert.equal(r.usedDefault, false);
  });

  it("records default fallback", () => {
    const records = [];
    onGateProfileTelemetry((r) => records.push(r));

    const profile = selectGateProfileWithTelemetry(["unknown-trigger-xyz"]);
    assert.equal(profile.profileId, "standard");
    const r = records[records.length - 1];
    assert.equal(r.usedDefault, true);
  });
});

// ═══ RTI-1C: Transcript Workload Telemetry ══════════════════════════════

describe("RTI-1C: Transcript workload telemetry", () => {
  it("emitTranscriptWorkload notifies callbacks", () => {
    const records = [];
    onTranscriptWorkload((m) => records.push(m));

    emitTranscriptWorkload({
      sessionId: "session-1",
      eventCount: 150,
      visibleLineCount: 2000,
      lastAppendTs: Date.now(),
      appendCadence: 5.2,
    });

    assert.ok(records.length >= 1);
    const r = records[records.length - 1];
    assert.equal(r.sessionId, "session-1");
    assert.equal(r.eventCount, 150);
    assert.equal(r.visibleLineCount, 2000);
  });

  it("callback errors do not propagate", () => {
    onTranscriptWorkload(() => { throw new Error("boom"); });

    // Should not throw
    emitTranscriptWorkload({
      sessionId: "session-2",
      eventCount: 10,
      visibleLineCount: 100,
      lastAppendTs: Date.now(),
      appendCadence: 1.0,
    });
  });
});
