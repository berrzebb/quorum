#!/usr/bin/env node
/**
 * Fitness Score Engine Tests — deterministic quality measurement.
 *
 * Tests:
 *   1. Component normalization (each signal → 0.0-1.0)
 *   2. Weighted total calculation
 *   3. Delta computation (before/after)
 *   4. Trend analysis (moving average + slope)
 *   5. Edge cases (missing signals, zero lines, custom weights)
 *
 * Run: node --test tests/fitness.test.mjs
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

const { computeFitness, computeDelta, computeTrend } = await import("../dist/bus/fitness.js");

// ═══ 1. Component normalization ══════════════════════════════════════════

describe("computeFitness components", () => {
  it("perfect signals → total near 1.0", () => {
    const score = computeFitness({
      typeAssertionCount: 0,
      effectiveLines: 1000,
      tscExitCode: 0,
      eslintExitCode: 0,
      lineCoverage: 100,
      branchCoverage: 100,
      highFindings: 0,
      totalFindings: 0,
      avgComplexity: 1,
      maxComplexity: 1,
    });
    assert.ok(score.total >= 0.95, `Expected >= 0.95, got ${score.total}`);
    assert.equal(score.components.buildHealth.value, 1);
    assert.equal(score.components.testCoverage.value, 1);
    assert.equal(score.components.patternScan.value, 1);
  });

  it("terrible signals → total near 0.0", () => {
    const score = computeFitness({
      typeAssertionCount: 100,
      effectiveLines: 100,  // 1000 assertions/KLOC → way above threshold
      tscExitCode: 1,
      eslintExitCode: 1,
      lineCoverage: 0,
      branchCoverage: 0,
      highFindings: 20,
      totalFindings: 50,
      avgComplexity: 30,
      maxComplexity: 50,
    });
    // security + dependencies have no bad signals → they default to 1.0
    // With 7 components (weights 0.10 + 0.05 = 0.15), terrible-only-5 gives ~0.15 floor
    assert.ok(score.total <= 0.20, `Expected <= 0.20, got ${score.total}`);
  });

  it("typeSafety: more assertions per KLOC → lower score", () => {
    const good = computeFitness({ typeAssertionCount: 0, effectiveLines: 1000 });
    const bad = computeFitness({ typeAssertionCount: 15, effectiveLines: 1000 });
    assert.ok(good.components.typeSafety.value > bad.components.typeSafety.value);
  });

  it("testCoverage: averages line + branch", () => {
    const score = computeFitness({ lineCoverage: 80, branchCoverage: 60 });
    assert.equal(score.components.testCoverage.value, 0.7);
  });

  it("patternScan: fewer HIGH findings → higher score", () => {
    const clean = computeFitness({ highFindings: 0 });
    const dirty = computeFitness({ highFindings: 5 });
    assert.ok(clean.components.patternScan.value > dirty.components.patternScan.value);
    assert.equal(clean.components.patternScan.value, 1);
  });

  it("buildHealth: tsc pass + eslint pass = 1.0", () => {
    const pass = computeFitness({ tscExitCode: 0, eslintExitCode: 0 });
    assert.equal(pass.components.buildHealth.value, 1);
    const halfFail = computeFitness({ tscExitCode: 1, eslintExitCode: 0 });
    assert.equal(halfFail.components.buildHealth.value, 0.5);
    const fullFail = computeFitness({ tscExitCode: 1, eslintExitCode: 1 });
    assert.equal(fullFail.components.buildHealth.value, 0);
  });

  it("complexity: lower avg → higher score", () => {
    const simple = computeFitness({ avgComplexity: 2 });
    const complex = computeFitness({ avgComplexity: 15 });
    assert.ok(simple.components.complexity.value > complex.components.complexity.value);
  });
});

// ═══ 2. Weighted total ═══════════════════════════════════════════════════

describe("computeFitness total", () => {
  it("total is weighted sum of components", () => {
    const score = computeFitness({
      typeAssertionCount: 0,
      effectiveLines: 1000,
      tscExitCode: 0,
      eslintExitCode: 0,
      lineCoverage: 80,
      branchCoverage: 80,
      highFindings: 0,
      avgComplexity: 5,
    });
    // Manual calculation (7 components with updated weights)
    const expected =
      score.components.typeSafety.value * 0.20 +
      score.components.testCoverage.value * 0.20 +
      score.components.patternScan.value * 0.20 +
      score.components.buildHealth.value * 0.15 +
      score.components.complexity.value * 0.10 +
      score.components.security.value * 0.10 +
      score.components.dependencies.value * 0.05;
    assert.ok(Math.abs(score.total - expected) < 0.01,
      `total ${score.total} should ≈ manual ${expected}`);
  });

  it("custom weights are respected", () => {
    const score = computeFitness(
      { lineCoverage: 100, branchCoverage: 100 },
      { weights: { testCoverage: 1.0, typeSafety: 0, patternScan: 0, buildHealth: 0, complexity: 0 } },
    );
    assert.ok(score.total >= 0.99, `Expected >= 0.99 with coverage-only weight, got ${score.total}`);
  });

  it("has snapshotId and timestamp", () => {
    const score = computeFitness({});
    assert.ok(score.snapshotId.length > 0);
    assert.ok(score.timestamp > 0);
  });
});

// ═══ 3. Delta computation ════════════════════════════════════════════════

describe("computeDelta", () => {
  it("computes improvement delta", () => {
    const before = computeFitness({ highFindings: 5, lineCoverage: 50, branchCoverage: 50 });
    const after = computeFitness({ highFindings: 0, lineCoverage: 80, branchCoverage: 80 });
    const delta = computeDelta(before, after);
    assert.ok(delta.delta > 0, "should show improvement");
    assert.equal(delta.improved, true);
    assert.ok(delta.components.patternScan.delta > 0);
    assert.ok(delta.components.testCoverage.delta > 0);
  });

  it("computes regression delta", () => {
    const before = computeFitness({ highFindings: 0, tscExitCode: 0 });
    const after = computeFitness({ highFindings: 5, tscExitCode: 1 });
    const delta = computeDelta(before, after);
    assert.ok(delta.delta < 0, "should show regression");
    assert.equal(delta.improved, false);
  });

  it("no change → delta = 0", () => {
    const score = computeFitness({ highFindings: 2, lineCoverage: 70, branchCoverage: 70 });
    const delta = computeDelta(score, score);
    assert.equal(delta.delta, 0);
  });
});

// ═══ 4. Trend analysis ══════════════════════════════════════════════════

describe("computeTrend", () => {
  it("improving trend has positive slope", () => {
    const trend = computeTrend([0.5, 0.55, 0.6, 0.65, 0.7]);
    assert.ok(trend.slope > 0, `Expected positive slope, got ${trend.slope}`);
    assert.ok(trend.movingAverage > 0.55);
  });

  it("declining trend has negative slope", () => {
    const trend = computeTrend([0.8, 0.75, 0.7, 0.65, 0.6]);
    assert.ok(trend.slope < 0, `Expected negative slope, got ${trend.slope}`);
  });

  it("flat trend has slope ≈ 0", () => {
    const trend = computeTrend([0.7, 0.7, 0.7, 0.7, 0.7]);
    assert.ok(Math.abs(trend.slope) < 0.001, `Expected slope ≈ 0, got ${trend.slope}`);
    assert.ok(Math.abs(trend.movingAverage - 0.7) < 0.01);
  });

  it("empty input → zeroes", () => {
    const trend = computeTrend([]);
    assert.equal(trend.movingAverage, 0);
    assert.equal(trend.slope, 0);
  });

  it("single point → no slope", () => {
    const trend = computeTrend([0.8]);
    assert.ok(Math.abs(trend.movingAverage - 0.8) < 0.01);
    assert.equal(trend.slope, 0);
  });

  it("respects windowSize", () => {
    // 10 data points, window of 3 → only last 3 used
    const scores = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0];
    const trend = computeTrend(scores, 3);
    // Last 3: [0.8, 0.9, 1.0] → avg = 0.9
    assert.ok(Math.abs(trend.movingAverage - 0.9) < 0.01);
  });
});

// ═══ 5. Edge cases ══════════════════════════════════════════════════════

describe("fitness edge cases", () => {
  it("all signals missing → defaults to mid-range", () => {
    const score = computeFitness({});
    assert.ok(score.total >= 0 && score.total <= 1);
    // With no coverage and no build info: some components should be 0
    assert.equal(score.components.testCoverage.value, 0);
  });

  it("zero effective lines → does not divide by zero", () => {
    const score = computeFitness({ effectiveLines: 0, typeAssertionCount: 5 });
    assert.ok(score.total >= 0 && score.total <= 1);
    // Should use min 0.1 KLOC floor
    assert.ok(score.components.typeSafety.value < 1);
  });

  it("custom thresholds change normalization", () => {
    // With default threshold (20 assertions/KLOC), 10/KLOC is 0.5
    const def = computeFitness({ typeAssertionCount: 10, effectiveLines: 1000 });
    // With threshold 10, 10/KLOC is at the limit → score = 0
    const strict = computeFitness(
      { typeAssertionCount: 10, effectiveLines: 1000 },
      { thresholds: { assertionsPerKLOC: 10 } },
    );
    assert.ok(def.components.typeSafety.value > strict.components.typeSafety.value);
  });

  it("values clamp at 0 and 1", () => {
    // Negative shouldn't happen but test clamping
    const score = computeFitness({ highFindings: 100 });
    assert.ok(score.components.patternScan.value >= 0);
    assert.ok(score.components.patternScan.value <= 1);
  });
});
