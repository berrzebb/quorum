#!/usr/bin/env node
/**
 * Fitness Loop Tests — autonomous quality gate.
 *
 * Tests:
 *   1. Baseline establishment (first evaluation)
 *   2. Three gate decisions: proceed, self-correct, auto-reject
 *   3. Baseline update on improvement
 *   4. History recording and trend calculation
 *   5. Store-less operation (fail-open)
 *   6. Reset
 *
 * Run: node --test tests/fitness-loop.test.mjs
 */

import { strict as assert } from "node:assert";
import { describe, it, before, after } from "node:test";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const { EventStore } = await import("../dist/bus/store.js");
const { FitnessLoop } = await import("../dist/bus/fitness-loop.js");
const { computeFitness } = await import("../dist/bus/fitness.js");

let tmpDir;

before(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "fitness-loop-test-"));
});

after(() => {
  try {
    if (tmpDir && existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  } catch {}
});

function makeStore() {
  const dbPath = join(tmpDir, `loop-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  return new EventStore({ dbPath });
}

function makeScore(overrides = {}) {
  return computeFitness({
    typeAssertionCount: 0,
    effectiveLines: 1000,
    tscExitCode: 0,
    eslintExitCode: 0,
    lineCoverage: 80,
    branchCoverage: 80,
    highFindings: 0,
    avgComplexity: 5,
    ...overrides,
  });
}

// ═══ 1. Baseline establishment ═══════════════════════════════════════════

describe("FitnessLoop baseline", () => {
  it("first evaluation establishes baseline and proceeds", () => {
    const store = makeStore();
    const loop = new FitnessLoop(store);
    const score = makeScore();
    const result = loop.evaluate(score);

    assert.equal(result.decision, "proceed");
    assert.ok(result.reason.includes("baseline"));

    const baseline = loop.getBaseline();
    assert.ok(baseline);
    assert.equal(baseline.total, score.total);
    store.close();
  });
});

// ═══ 2. Gate decisions ═══════════════════════════════════════════════════

describe("FitnessLoop gate decisions", () => {
  it("proceed: score improved", () => {
    const store = makeStore();
    const loop = new FitnessLoop(store);

    const baseline = makeScore({ highFindings: 3, lineCoverage: 60, branchCoverage: 60 });
    loop.evaluate(baseline); // establish baseline

    const improved = makeScore({ highFindings: 0, lineCoverage: 90, branchCoverage: 90 });
    const result = loop.evaluate(improved);

    assert.equal(result.decision, "proceed");
    assert.ok(result.delta > 0);
    store.close();
  });

  it("proceed: score maintained (delta ≈ 0)", () => {
    const store = makeStore();
    const loop = new FitnessLoop(store);

    const score = makeScore();
    loop.evaluate(score); // baseline
    const result = loop.evaluate(score); // same score

    assert.equal(result.decision, "proceed");
    assert.equal(result.delta, 0);
    store.close();
  });

  it("self-correct: mild regression", () => {
    const store = makeStore();
    const loop = new FitnessLoop(store, { warnThreshold: -0.05, rejectThreshold: -0.15 });

    const good = makeScore({ highFindings: 0, lineCoverage: 90, branchCoverage: 90 });
    loop.evaluate(good); // baseline

    // Slightly worse
    const worse = makeScore({ highFindings: 2, lineCoverage: 80, branchCoverage: 80 });
    const result = loop.evaluate(worse);

    assert.equal(result.decision, "self-correct");
    assert.ok(result.delta < 0);
    store.close();
  });

  it("auto-reject: significant regression", () => {
    const store = makeStore();
    const loop = new FitnessLoop(store, { rejectThreshold: -0.15 });

    const good = makeScore({ highFindings: 0, tscExitCode: 0, lineCoverage: 90, branchCoverage: 90 });
    loop.evaluate(good); // baseline

    // Much worse
    const bad = makeScore({ highFindings: 8, tscExitCode: 1, lineCoverage: 30, branchCoverage: 30 });
    const result = loop.evaluate(bad);

    assert.equal(result.decision, "auto-reject");
    assert.ok(result.delta < -0.15);
    assert.ok(result.details);
    store.close();
  });

  it("auto-reject: score below minimum threshold", () => {
    const store = makeStore();
    const loop = new FitnessLoop(store, { minScore: 0.3 });

    const ok = makeScore();
    loop.evaluate(ok); // baseline

    // Terrible score
    const terrible = makeScore({
      highFindings: 15,
      tscExitCode: 1,
      eslintExitCode: 1,
      lineCoverage: 0,
      branchCoverage: 0,
      typeAssertionCount: 50,
      avgComplexity: 20,
    });
    const result = loop.evaluate(terrible);

    assert.equal(result.decision, "auto-reject");
    assert.ok(result.current < 0.3);
    store.close();
  });
});

// ═══ 3. Baseline update on improvement ═══════════════════════════════════

describe("FitnessLoop baseline update", () => {
  it("updates baseline when score improves", () => {
    const store = makeStore();
    const loop = new FitnessLoop(store);

    const v1 = makeScore({ highFindings: 3 });
    loop.evaluate(v1);
    assert.equal(loop.getBaseline().total, v1.total);

    const v2 = makeScore({ highFindings: 0 });
    loop.evaluate(v2);
    assert.equal(loop.getBaseline().total, v2.total);
    store.close();
  });

  it("does not update baseline on regression", () => {
    const store = makeStore();
    const loop = new FitnessLoop(store);

    const good = makeScore({ highFindings: 0 });
    loop.evaluate(good);
    const baselineTotal = loop.getBaseline().total;

    const worse = makeScore({ highFindings: 2 });
    loop.evaluate(worse);
    assert.equal(loop.getBaseline().total, baselineTotal); // unchanged
    store.close();
  });
});

// ═══ 4. History and trend ════════════════════════════════════════════════

describe("FitnessLoop history and trend", () => {
  it("records history of evaluations", () => {
    const store = makeStore();
    const loop = new FitnessLoop(store);

    for (let i = 0; i < 5; i++) {
      loop.evaluate(makeScore({ highFindings: 5 - i }));
    }

    const history = loop.getHistory();
    assert.equal(history.length, 5);
    // Scores should be increasing (fewer findings = higher score)
    assert.ok(history[4] >= history[0]);
    store.close();
  });

  it("computes trend from history", () => {
    const store = makeStore();
    const loop = new FitnessLoop(store, { trendWindow: 3 });

    // Improving sequence
    for (let i = 0; i < 5; i++) {
      loop.evaluate(makeScore({ highFindings: 5 - i }));
    }

    const trend = loop.getTrend();
    assert.ok(trend.slope > 0, `Expected positive slope, got ${trend.slope}`);
    assert.equal(trend.windowSize, 3);
    assert.equal(trend.dataPoints, 5);
    store.close();
  });

  it("limits history to 50 entries", () => {
    const store = makeStore();
    const loop = new FitnessLoop(store);

    for (let i = 0; i < 55; i++) {
      loop.evaluate(makeScore({ highFindings: i % 5 }));
    }

    const history = loop.getHistory();
    assert.ok(history.length <= 50);
    store.close();
  });
});

// ═══ 5. Store-less operation ═════════════════════════════════════════════

describe("FitnessLoop without store (fail-open)", () => {
  it("proceeds without store", () => {
    const loop = new FitnessLoop(null);
    const score = makeScore();
    const result = loop.evaluate(score);
    assert.equal(result.decision, "proceed");
  });

  it("getBaseline returns null", () => {
    const loop = new FitnessLoop(null);
    assert.equal(loop.getBaseline(), null);
  });

  it("getHistory returns empty array", () => {
    const loop = new FitnessLoop(null);
    assert.deepEqual(loop.getHistory(), []);
  });

  it("getTrend returns zeroes", () => {
    const loop = new FitnessLoop(null);
    const trend = loop.getTrend();
    assert.equal(trend.movingAverage, 0);
    assert.equal(trend.slope, 0);
  });
});

// ═══ 6. Reset ════════════════════════════════════════════════════════════

describe("FitnessLoop reset", () => {
  it("clears baseline and history", () => {
    const store = makeStore();
    const loop = new FitnessLoop(store);

    loop.evaluate(makeScore());
    loop.evaluate(makeScore({ highFindings: 2 }));
    assert.ok(loop.getBaseline() !== null);
    assert.ok(loop.getHistory().length > 0);

    loop.reset();
    assert.equal(loop.getBaseline(), null);
    assert.deepEqual(loop.getHistory(), []);
    store.close();
  });
});
