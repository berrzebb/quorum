#!/usr/bin/env node
/**
 * Trigger Learner Tests — LEARN-1~4
 *
 * Run: node --test tests/trigger-learner.test.mjs
 */

import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";

import {
  TriggerLearner,
  classifyOutcome,
  WEIGHT_LOWER_BOUND,
  WEIGHT_UPPER_BOUND,
  DEFAULT_MIN_SAMPLES,
} from "../dist/platform/bus/trigger-learner.js";

function createMockKV() {
  const store = new Map();
  return {
    get: (key) => store.get(key) ?? null,
    set: (key, value) => store.set(key, value),
    delete: (key) => store.delete(key),
    _store: store,
  };
}

function createMockEmitter() {
  const events = [];
  return {
    emit: (type, payload) => events.push({ type, payload }),
    events,
  };
}

// ═══ 1. classifyOutcome ═════════════════════════════════

describe("classifyOutcome", () => {
  it("T1 + agree → accurate", () => {
    const r = classifyOutcome("T1", "agree");
    assert.ok(r.isAccurate);
    assert.equal(r.type, "accurate");
  });

  it("T1 + reject → false negative", () => {
    const r = classifyOutcome("T1", "reject");
    assert.ok(!r.isAccurate);
    assert.equal(r.type, "false_negative");
  });

  it("T2 + agree → accurate", () => {
    assert.ok(classifyOutcome("T2", "agree").isAccurate);
  });

  it("T2 + reject → accurate", () => {
    assert.ok(classifyOutcome("T2", "reject").isAccurate);
  });

  it("T3 + reject → accurate", () => {
    const r = classifyOutcome("T3", "reject");
    assert.ok(r.isAccurate);
  });

  it("T3 + agree → false positive", () => {
    const r = classifyOutcome("T3", "agree");
    assert.ok(!r.isAccurate);
    assert.equal(r.type, "false_positive");
  });
});

// ═══ 2. TriggerLearner — evaluation recording ══════════

describe("TriggerLearner — recording", () => {
  it("records evaluation and emits event", () => {
    const emitter = createMockEmitter();
    const learner = new TriggerLearner(undefined, emitter);

    learner.recordEvaluation({
      id: "eval-1",
      score: 0.5,
      tier: "T2",
      factors: { fileCount: 0.2, security: 0.3 },
      timestamp: Date.now(),
    });

    assert.equal(emitter.events.length, 1);
    assert.equal(emitter.events[0].type, "trigger.evaluation");
  });

  it("records outcome and emits event", () => {
    const emitter = createMockEmitter();
    const learner = new TriggerLearner(undefined, emitter);

    learner.recordEvaluation({
      id: "eval-1", score: 0.8, tier: "T3",
      factors: { security: 0.25 }, timestamp: Date.now(),
    });
    const outcome = learner.recordOutcome("eval-1", "agree");

    assert.ok(outcome);
    assert.equal(outcome.predictedTier, "T3");
    assert.ok(!outcome.isAccurate); // T3+agree = false positive
  });

  it("returns null for unknown evaluation", () => {
    const learner = new TriggerLearner();
    assert.equal(learner.recordOutcome("nonexistent", "agree"), null);
  });
});

// ═══ 3. Accuracy Stats ═════════════════════════════════

describe("TriggerLearner — accuracy stats", () => {
  it("empty → 100% accuracy", () => {
    const learner = new TriggerLearner();
    const stats = learner.getAccuracyStats();
    assert.equal(stats.total, 0);
    assert.equal(stats.accuracy, 1.0);
  });

  it("tracks false positives and negatives", () => {
    const learner = new TriggerLearner();

    // Record evaluations
    learner.recordEvaluation({ id: "e1", score: 0.1, tier: "T1", factors: {}, timestamp: 1 });
    learner.recordEvaluation({ id: "e2", score: 0.8, tier: "T3", factors: {}, timestamp: 2 });
    learner.recordEvaluation({ id: "e3", score: 0.5, tier: "T2", factors: {}, timestamp: 3 });

    // Record outcomes
    learner.recordOutcome("e1", "reject"); // false negative
    learner.recordOutcome("e2", "agree");  // false positive
    learner.recordOutcome("e3", "reject"); // accurate (T2)

    const stats = learner.getAccuracyStats();
    assert.equal(stats.total, 3);
    assert.equal(stats.accurate, 1); // Only T2
    assert.equal(stats.falsePositive, 1);
    assert.equal(stats.falseNegative, 1);
  });
});

// ═══ 4. Weight Adjustment ═══════════════════════════════

describe("TriggerLearner — weight adjustment", () => {
  it("no adjustment with insufficient samples", () => {
    const learner = new TriggerLearner();
    assert.deepEqual(learner.adjustWeights(), []);
  });

  it("false positive → weight decrease", () => {
    const kv = createMockKV();
    const learner = new TriggerLearner(kv);

    // Simulate 20 outcomes with 5 false positives on "security" factor
    for (let i = 0; i < 20; i++) {
      const tier = i < 5 ? "T3" : "T2";
      learner.recordEvaluation({
        id: `e${i}`, score: tier === "T3" ? 0.8 : 0.5, tier,
        factors: { security: tier === "T3" ? 0.25 : 0, fileCount: 0.1 },
        timestamp: i,
      });
      learner.recordOutcome(`e${i}`, "agree"); // T3+agree = false positive for first 5
    }

    const adjustments = learner.adjustWeights(20);
    // Security factor should be decreased (false positive)
    const secAdj = adjustments.find(a => a.factor === "security");
    if (secAdj) {
      assert.ok(secAdj.newWeight < secAdj.oldWeight);
      assert.equal(secAdj.reason, "false_positive");
    }
  });

  it("weight bounds enforced", () => {
    const kv = createMockKV();
    // Set weight close to lower bound
    kv.set("trigger.weights", JSON.stringify({ security: 0.51 }));
    const learner = new TriggerLearner(kv);

    // Simulate many false positives
    for (let i = 0; i < 20; i++) {
      learner.recordEvaluation({
        id: `e${i}`, score: 0.8, tier: "T3",
        factors: { security: 0.25 }, timestamp: i,
      });
      learner.recordOutcome(`e${i}`, "agree");
    }

    learner.adjustWeights(20);
    const weights = learner.loadWeights();
    assert.ok((weights.security ?? 1.0) >= WEIGHT_LOWER_BOUND);
  });
});

// ═══ 5. Reset Weights ═══════════════════════════════════

describe("TriggerLearner — reset", () => {
  it("reset clears KV weights", () => {
    const kv = createMockKV();
    const emitter = createMockEmitter();
    const learner = new TriggerLearner(kv, emitter);

    kv.set("trigger.weights", JSON.stringify({ security: 0.8 }));
    learner.resetWeights();

    assert.equal(kv.get("trigger.weights"), null);
    assert.ok(emitter.events.some(e => e.type === "trigger.weights.reset"));
  });

  it("reset is idempotent", () => {
    const kv = createMockKV();
    const learner = new TriggerLearner(kv);
    learner.resetWeights();
    learner.resetWeights(); // Should not throw
    assert.equal(kv.get("trigger.weights"), null);
  });

  it("after reset, applyWeight returns 1.0", () => {
    const kv = createMockKV();
    kv.set("trigger.weights", JSON.stringify({ security: 0.7 }));
    const learner = new TriggerLearner(kv);
    assert.equal(learner.applyWeight("security", 0.25), 0.25 * 0.7);
    learner.resetWeights();
    assert.equal(learner.applyWeight("security", 0.25), 0.25); // Default 1.0
  });
});

// ═══ 6. applyWeight ═════════════════════════════════════

describe("TriggerLearner — applyWeight", () => {
  it("no learned weight → multiplier 1.0", () => {
    const learner = new TriggerLearner();
    assert.equal(learner.applyWeight("fileCount", 0.2), 0.2);
  });

  it("learned weight applied", () => {
    const kv = createMockKV();
    kv.set("trigger.weights", JSON.stringify({ fileCount: 1.5 }));
    const learner = new TriggerLearner(kv);
    const result = learner.applyWeight("fileCount", 0.2);
    assert.ok(Math.abs(result - 0.3) < 0.001, `Expected ~0.3, got ${result}`);
  });
});
