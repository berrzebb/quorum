#!/usr/bin/env node
/**
 * RTI-2A: Approval Classifier — Pure Heuristic Tests
 *
 * Core safety invariant: high-risk (destructive/network/diff)
 * requests NEVER receive auto-allow classification.
 *
 * Run: node --test tests/approval-classifier.test.mjs
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

const {
  classify,
  telemetryToInput,
  validateSafetyInvariant,
} = await import("../dist/platform/bus/approval-classifier.js");

// ═══ 1. Safety Invariant ════════════════════════════════════════════════

describe("Safety invariant: high-risk never auto-allow", () => {
  it("destructive tool → auto-deny", () => {
    const decision = classify({
      tool: "delete_file",
      kind: "tool",
      readOnly: false,
      destructive: true,
      network: false,
      diff: false,
    });
    assert.notEqual(decision.bucket, "auto-allow");
    assert.equal(decision.bucket, "auto-deny");
    assert.ok(validateSafetyInvariant({ tool: "delete_file", kind: "tool", readOnly: false, destructive: true, network: false, diff: false }, decision));
  });

  it("network request → needs-human", () => {
    const decision = classify({
      tool: "fetch_url",
      kind: "network",
      readOnly: false,
      destructive: false,
      network: true,
      diff: false,
    });
    assert.notEqual(decision.bucket, "auto-allow");
    assert.ok(decision.bucket === "needs-human" || decision.bucket === "auto-deny");
  });

  it("diff request → needs-human", () => {
    const decision = classify({
      tool: "apply_diff",
      kind: "diff",
      readOnly: false,
      destructive: false,
      network: false,
      diff: true,
    });
    assert.notEqual(decision.bucket, "auto-allow");
  });

  it("destructive + network → auto-deny", () => {
    const decision = classify({
      tool: "rm_remote",
      kind: "command",
      readOnly: false,
      destructive: true,
      network: true,
      diff: false,
    });
    assert.equal(decision.bucket, "auto-deny");
  });

  it("safety invariant fails on hypothetical violation", () => {
    const fakeDecision = {
      bucket: "auto-allow",
      confidence: 0.9,
      reason: "fake",
      recommendedDecision: "allow",
      signals: [],
    };
    const result = validateSafetyInvariant(
      { tool: "x", kind: "tool", readOnly: false, destructive: true, network: false, diff: false },
      fakeDecision,
    );
    assert.equal(result, false, "Should detect invariant violation");
  });
});

// ═══ 2. Safe Bucket Classification ══════════════════════════════════════

describe("Safe bucket classification", () => {
  it("read-only tool → auto-allow", () => {
    const decision = classify({
      tool: "code_map",
      kind: "tool",
      readOnly: true,
      destructive: false,
      network: false,
      diff: false,
    });
    assert.equal(decision.bucket, "auto-allow");
    assert.ok(decision.confidence >= 0.7);
  });

  it("read-only + concurrencySafe → high confidence auto-allow", () => {
    const decision = classify({
      tool: "blast_radius",
      kind: "tool",
      readOnly: true,
      destructive: false,
      network: false,
      diff: false,
      concurrencySafe: true,
    });
    assert.equal(decision.bucket, "auto-allow");
    assert.ok(decision.confidence >= 0.8);
  });

  it("unknown non-dangerous tool → auto-allow or needs-human", () => {
    const decision = classify({
      tool: "custom_tool",
      kind: "tool",
      readOnly: false,
      destructive: false,
      network: false,
      diff: false,
    });
    // Low risk without explicit signals → auto-allow with lower confidence
    assert.ok(decision.bucket === "auto-allow" || decision.bucket === "needs-human");
  });
});

// ═══ 3. Decision Shape ══════════════════════════════════════════════════

describe("ClassifierDecision shape", () => {
  it("has all required fields", () => {
    const decision = classify({
      tool: "test_tool",
      kind: "tool",
      readOnly: true,
      destructive: false,
      network: false,
      diff: false,
    });

    assert.ok(["auto-allow", "auto-deny", "needs-human"].includes(decision.bucket));
    assert.equal(typeof decision.confidence, "number");
    assert.ok(decision.confidence >= 0 && decision.confidence <= 1);
    assert.equal(typeof decision.reason, "string");
    assert.ok(decision.reason.length > 0);
    assert.ok(["allow", "deny"].includes(decision.recommendedDecision));
    assert.ok(Array.isArray(decision.signals));
  });

  it("signals include expected names", () => {
    const decision = classify({
      tool: "test",
      kind: "tool",
      readOnly: true,
      destructive: false,
      network: false,
      diff: false,
    });
    const signalNames = decision.signals.map(s => s.name);
    assert.ok(signalNames.includes("readOnly"));
    assert.ok(signalNames.includes("destructive"));
    assert.ok(signalNames.includes("network"));
    assert.ok(signalNames.includes("diff"));
  });
});

// ═══ 4. Telemetry Replay ════════════════════════════════════════════════

describe("telemetryToInput", () => {
  it("converts telemetry record to classifier input", () => {
    const input = telemetryToInput({
      ts: Date.now(),
      provider: "claude",
      sessionId: "s-1",
      tool: "code_map",
      kind: "tool",
      readOnly: true,
      destructive: false,
      network: false,
      diff: false,
      decision: "allow",
      decidedBy: "allow-all",
      reason: "test",
    });

    assert.equal(input.tool, "code_map");
    assert.equal(input.readOnly, true);
    assert.equal(input.destructive, false);

    // Replayed decision should match
    const decision = classify(input);
    assert.equal(decision.bucket, "auto-allow");
  });

  it("replay of destructive tool preserves safety", () => {
    const input = telemetryToInput({
      ts: Date.now(),
      provider: "codex",
      sessionId: "s-2",
      tool: "dangerous_op",
      kind: "tool",
      readOnly: false,
      destructive: true,
      network: false,
      diff: false,
      decision: "deny",
      decidedBy: "default",
      reason: "test",
    });

    const decision = classify(input);
    assert.notEqual(decision.bucket, "auto-allow");
  });
});

// ═══ 5. Exhaustive High-Risk Coverage ═══════════════════════════════════

describe("Exhaustive high-risk coverage", () => {
  const highRiskCombinations = [
    { destructive: true, network: false, diff: false },
    { destructive: false, network: true, diff: false },
    { destructive: false, network: false, diff: true },
    { destructive: true, network: true, diff: false },
    { destructive: true, network: false, diff: true },
    { destructive: false, network: true, diff: true },
    { destructive: true, network: true, diff: true },
  ];

  for (const combo of highRiskCombinations) {
    const label = Object.entries(combo).filter(([, v]) => v).map(([k]) => k).join("+");
    it(`${label} → never auto-allow`, () => {
      const decision = classify({
        tool: "test_tool",
        kind: "tool",
        readOnly: false,
        ...combo,
      });
      assert.notEqual(decision.bucket, "auto-allow", `${label} should not be auto-allow`);
      assert.ok(validateSafetyInvariant(
        { tool: "test_tool", kind: "tool", readOnly: false, ...combo },
        decision,
      ));
    });
  }
});
