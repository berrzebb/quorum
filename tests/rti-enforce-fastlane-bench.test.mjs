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
});
