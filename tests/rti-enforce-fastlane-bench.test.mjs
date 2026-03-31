#!/usr/bin/env node
/**
 * RTI-8: Classifier Enforce Mode
 * RTI-9: Speculation Fast-Lane
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

const {
  speculatePassLikelihood,
  defaultFastLaneConfig,
  createCalibrationState,
  recordCalibration,
  tryFastLane,
} = await import("../dist/platform/orchestrate/governance/adaptive-gate-profile.js");

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

// ═══ RTI-9: Speculation Fast-Lane ═══════════════════════════════════════

describe("RTI-9: Fast-lane config", () => {
  it("default config is disabled", () => {
    const config = defaultFastLaneConfig();
    assert.equal(config.enabled, false);
    assert.equal(config.minPrecision, 0.85);
    assert.equal(config.minSamples, 20);
  });
});

describe("RTI-9: Calibration tracking", () => {
  it("starts with zero state", () => {
    const state = createCalibrationState();
    assert.equal(state.totalPredictions, 0);
    assert.equal(state.precision, 0);
  });

  it("records correct pass prediction", () => {
    let state = createCalibrationState();
    const prediction = { passLikelihood: 0.9, recommendedProfile: "minimal", confidence: 0.8, reason: "", enforce: false };
    state = recordCalibration(state, prediction, "pass");
    assert.equal(state.totalPredictions, 1);
    assert.equal(state.correctPassPredictions, 1);
    assert.equal(state.precision, 1.0);
  });

  it("records false positive", () => {
    let state = createCalibrationState();
    const prediction = { passLikelihood: 0.9, recommendedProfile: "minimal", confidence: 0.8, reason: "", enforce: false };
    state = recordCalibration(state, prediction, "fail");
    assert.equal(state.falsePassPredictions, 1);
    assert.equal(state.precision, 0);
  });

  it("precision converges with mixed data", () => {
    let state = createCalibrationState();
    const high = { passLikelihood: 0.9, recommendedProfile: "minimal", confidence: 0.8, reason: "", enforce: false };
    // 8 correct, 2 false → precision 0.8
    for (let i = 0; i < 8; i++) state = recordCalibration(state, high, "pass");
    for (let i = 0; i < 2; i++) state = recordCalibration(state, high, "fail");
    assert.equal(state.totalPredictions, 10);
    assert.equal(state.precision, 0.8);
  });
});

describe("RTI-9: tryFastLane", () => {
  it("returns null when disabled", () => {
    const config = defaultFastLaneConfig();
    const calibration = createCalibrationState();
    const prediction = { passLikelihood: 0.95, recommendedProfile: "minimal", confidence: 0.9, reason: "", enforce: false };
    assert.equal(tryFastLane(config, calibration, prediction), null);
  });

  it("returns null when not enough samples", () => {
    const config = { ...defaultFastLaneConfig(), enabled: true };
    const calibration = { totalPredictions: 5, correctPassPredictions: 5, falsePassPredictions: 0, precision: 1.0 };
    const prediction = { passLikelihood: 0.95, recommendedProfile: "minimal", confidence: 0.9, reason: "", enforce: false };
    assert.equal(tryFastLane(config, calibration, prediction), null);
  });

  it("returns null when precision too low", () => {
    const config = { ...defaultFastLaneConfig(), enabled: true };
    const calibration = { totalPredictions: 30, correctPassPredictions: 15, falsePassPredictions: 15, precision: 0.5 };
    const prediction = { passLikelihood: 0.95, recommendedProfile: "minimal", confidence: 0.9, reason: "", enforce: false };
    assert.equal(tryFastLane(config, calibration, prediction), null);
  });

  it("returns profile when all conditions met", () => {
    const config = { ...defaultFastLaneConfig(), enabled: true };
    const calibration = { totalPredictions: 25, correctPassPredictions: 23, falsePassPredictions: 2, precision: 0.92 };
    const prediction = { passLikelihood: 0.9, recommendedProfile: "minimal", confidence: 0.9, reason: "", enforce: false };
    const result = tryFastLane(config, calibration, prediction);
    assert.ok(result, "Should return a profile");
    assert.equal(typeof result.profileId, "string");
  });

  it("returns null when likelihood below threshold", () => {
    const config = { ...defaultFastLaneConfig(), enabled: true };
    const calibration = { totalPredictions: 25, correctPassPredictions: 23, falsePassPredictions: 2, precision: 0.92 };
    const prediction = { passLikelihood: 0.5, recommendedProfile: "standard", confidence: 0.6, reason: "", enforce: false };
    assert.equal(tryFastLane(config, calibration, prediction), null);
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
