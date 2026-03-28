#!/usr/bin/env node
/**
 * Trigger + Fitness Integration Tests.
 *
 * Tests:
 *   1. fitnessScore factor in trigger evaluation
 *   2. fitness-plateau stagnation detection
 *
 * Run: node --test tests/trigger-fitness.test.mjs
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

const { evaluateTrigger } = await import("../dist/platform/providers/trigger.js");
const { detectStagnation } = await import("../dist/platform/bus/stagnation.js");

// ═══ 1. Trigger: fitnessScore factor ═════════════════════════════════════

describe("trigger: fitnessScore factor", () => {
  const baseCtx = {
    changedFiles: 3,
    securitySensitive: false,
    priorRejections: 0,
    apiSurfaceChanged: false,
    crossLayerChange: false,
    isRevert: false,
  };

  it("low fitness increases score", () => {
    const withoutFitness = evaluateTrigger({ ...baseCtx });
    const withLowFitness = evaluateTrigger({ ...baseCtx, fitnessScore: 0.2 });
    assert.ok(withLowFitness.score > withoutFitness.score,
      `Score with low fitness (${withLowFitness.score}) should be > without (${withoutFitness.score})`);
    assert.ok(withLowFitness.reasons.some(r => r.includes("fitness")));
  });

  it("high fitness does not increase score", () => {
    const withoutFitness = evaluateTrigger({ ...baseCtx });
    const withHighFitness = evaluateTrigger({ ...baseCtx, fitnessScore: 0.8 });
    assert.equal(withHighFitness.score, withoutFitness.score);
  });

  it("fitness at threshold (0.5) does not increase score", () => {
    const withoutFitness = evaluateTrigger({ ...baseCtx });
    const atThreshold = evaluateTrigger({ ...baseCtx, fitnessScore: 0.5 });
    assert.equal(atThreshold.score, withoutFitness.score);
  });

  it("fitness score 0 adds maximum contribution (0.15)", () => {
    const withoutFitness = evaluateTrigger({ ...baseCtx });
    const zeroFitness = evaluateTrigger({ ...baseCtx, fitnessScore: 0 });
    const diff = zeroFitness.score - withoutFitness.score;
    assert.ok(Math.abs(diff - 0.15) < 0.01, `Expected ~0.15 increase, got ${diff}`);
  });

  it("low fitness can push T1 → T2", () => {
    // Minimal change: 1 file, should be T1 normally
    const minimal = { ...baseCtx, changedFiles: 1 };
    const t1 = evaluateTrigger(minimal);
    assert.equal(t1.tier, "T1");

    // With very low fitness + some rejections → might push to T2
    const pushed = evaluateTrigger({ ...minimal, fitnessScore: 0.1, priorRejections: 2 });
    assert.ok(pushed.score > t1.score);
  });
});

// ═══ 2. Stagnation: fitness-plateau ══════════════════════════════════════

describe("stagnation: fitness-plateau", () => {
  const makeVerdictEvents = (count) =>
    Array.from({ length: count }, (_, i) => ({
      type: "audit.verdict",
      timestamp: Date.now() - (count - i) * 1000,
      source: "claude-code",
      payload: {
        verdict: "changes_requested",
        codes: ["test-gap"],
        summary: `verdict ${i}`,
      },
    }));

  it("detects plateau when fitness scores are flat", () => {
    const events = makeVerdictEvents(5);
    const flatHistory = [0.65, 0.65, 0.65, 0.65, 0.65];
    const result = detectStagnation(events, {}, flatHistory);
    const plateau = result.patterns.find(p => p.type === "fitness-plateau");
    assert.ok(plateau, "Should detect fitness-plateau");
    assert.ok(plateau.confidence > 0.5);
    assert.ok(plateau.detail.includes("plateaued"));
  });

  it("does not detect plateau when improving", () => {
    const events = makeVerdictEvents(5);
    const improvingHistory = [0.5, 0.55, 0.6, 0.65, 0.7];
    const result = detectStagnation(events, {}, improvingHistory);
    const plateau = result.patterns.find(p => p.type === "fitness-plateau");
    assert.ok(!plateau, "Should NOT detect plateau on improving trend");
  });

  it("does not detect plateau with insufficient data", () => {
    const events = makeVerdictEvents(5);
    const shortHistory = [0.65, 0.65];
    const result = detectStagnation(events, {}, shortHistory);
    const plateau = result.patterns.find(p => p.type === "fitness-plateau");
    assert.ok(!plateau, "Should NOT detect plateau with < 5 data points");
  });

  it("works without fitnessHistory (backward compatible)", () => {
    const events = makeVerdictEvents(5);
    const result = detectStagnation(events);
    // Should not crash, and should still detect other patterns
    assert.ok(typeof result.detected === "boolean");
  });
});
