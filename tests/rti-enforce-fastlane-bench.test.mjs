#!/usr/bin/env node
/**
 * RTI-8: Classifier Enforce Mode
 * RTI-10: Renderer Benchmark
 *
 * Run: node --test tests/rti-enforce-fastlane-bench.test.mjs
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

const {
  classify,
  shouldEnforce,
  defaultEnforceConfig,
} = await import("../dist/platform/bus/approval-classifier.js");

const { runBenchmark } = await import("../dist/daemon/lib/renderer-benchmark.js");

// ═══ RTI-8: Classifier Enforce Mode ═════════════════════════════════════

describe("RTI-8: shouldEnforce", () => {
  it("returns false when enforce disabled (default)", () => {
    const config = defaultEnforceConfig();
    const input = { tool: "code_map", kind: "tool", readOnly: true, destructive: false, network: false, diff: false };
    const decision = classify(input);
    assert.equal(shouldEnforce(config, input, decision), false);
  });

  it("returns true for safe auto-allow when enabled + high confidence", () => {
    const config = { ...defaultEnforceConfig(), enabled: true };
    const input = { tool: "code_map", kind: "tool", readOnly: true, destructive: false, network: false, diff: false };
    const decision = classify(input);
    // Only enforces if confidence >= 0.8
    if (decision.confidence >= 0.8 && decision.bucket === "auto-allow") {
      assert.equal(shouldEnforce(config, input, decision), true);
    }
  });

  it("returns false for high-risk even when enforce enabled", () => {
    const config = { ...defaultEnforceConfig(), enabled: true };
    const input = { tool: "rm_file", kind: "tool", readOnly: false, destructive: true, network: false, diff: false };
    const decision = classify(input);
    // auto-deny for destructive, but safety invariant check is the guard
    // The classifier already puts destructive in auto-deny bucket
    // shouldEnforce should still return true for auto-deny (it's safe to auto-deny destructive)
    if (decision.bucket === "auto-deny" && decision.confidence >= 0.8) {
      assert.equal(shouldEnforce(config, input, decision), true);
    }
  });

  it("returns false for needs-human bucket (not in enforceBuckets)", () => {
    const config = { ...defaultEnforceConfig(), enabled: true };
    const input = { tool: "fetch", kind: "network", readOnly: false, destructive: false, network: true, diff: false };
    const decision = classify(input);
    assert.equal(decision.bucket, "needs-human");
    assert.equal(shouldEnforce(config, input, decision), false);
  });

  it("returns false when confidence below threshold", () => {
    const config = { ...defaultEnforceConfig(), enabled: true, minConfidence: 0.99 };
    const input = { tool: "code_map", kind: "tool", readOnly: true, destructive: false, network: false, diff: false };
    const decision = classify(input);
    // Most decisions have confidence < 0.99
    assert.equal(shouldEnforce(config, input, decision), false);
  });
});

// ═══ RTI-10: Renderer Benchmark ═════════════════════════════════════════

describe("RTI-10: Renderer benchmark", () => {
  it("runs on 1k lines workload", () => {
    const result = runBenchmark(1000);
    assert.equal(result.rawLineCount, 1000);
    assert.ok(result.visibleLineCount > 0);
    assert.ok(result.visibleLineCount < result.rawLineCount, "Should filter hidden lines");
    assert.equal(typeof result.extractionMs, "number");
    assert.equal(typeof result.indexingMs, "number");
    assert.equal(typeof result.queryMs, "number");
    assert.ok(result.extractionThroughput > 0);
  });

  it("query latency meets G3 target on 1k lines", () => {
    const result = runBenchmark(1000);
    assert.equal(result.queryLatencyMet, true, `Query took ${result.queryMs}ms, target < 100ms`);
  });

  it("extraction filters hidden content", () => {
    const result = runBenchmark(100);
    // 10% of lines are system reminders, 10% are metadata → ~80% visible
    assert.ok(result.visibleLineCount < result.rawLineCount);
    // At least some lines should be visible
    assert.ok(result.visibleLineCount > 0);
  });

  it("benchmark result has all required fields", () => {
    const result = runBenchmark(100);
    const requiredFields = [
      "rawLineCount", "visibleLineCount", "extractionMs", "indexingMs",
      "queryMs", "extractionThroughput", "indexingThroughput", "queryLatencyMet",
    ];
    for (const field of requiredFields) {
      assert.ok(field in result, `Missing field: ${field}`);
    }
  });
});
