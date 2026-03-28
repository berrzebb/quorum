#!/usr/bin/env node
/**
 * TierRouter Tests — complexity scoring, escalation, downgrade.
 *
 * Run: node --test tests/router.test.mjs
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

const { TierRouter } = await import("../dist/platform/providers/router.js");

// ═══ 1. Complexity routing ════════════════════════════════════════════

describe("complexity routing", () => {
  it("routes small tasks to frugal tier", () => {
    const router = new TierRouter();
    const decision = router.route("t1", { changedFiles: 2, toolDependencies: 0, nestingDepth: 1 });
    assert.equal(decision.tier, "frugal");
    assert.ok(decision.complexity.total < 0.4);
    assert.equal(decision.escalated, false);
  });

  it("routes medium tasks to standard tier", () => {
    const router = new TierRouter();
    const decision = router.route("t2", { changedFiles: 10, toolDependencies: 2, nestingDepth: 2 });
    assert.equal(decision.tier, "standard");
  });

  it("routes complex tasks to frontier tier", () => {
    const router = new TierRouter();
    const decision = router.route("t3", { changedFiles: 20, toolDependencies: 5, nestingDepth: 5 });
    assert.equal(decision.tier, "frontier");
    assert.ok(decision.complexity.total >= 0.7);
  });

  it("caps complexity factors at 1.0", () => {
    const router = new TierRouter();
    const decision = router.route("t4", { changedFiles: 100, toolDependencies: 50, nestingDepth: 50 });
    assert.equal(decision.complexity.total, 1.0);
  });
});

// ═══ 2. Escalation ════════════════════════════════════════════════════

describe("escalation", () => {
  it("escalates after 2 consecutive failures", () => {
    const router = new TierRouter();

    const r1 = router.recordResult("task-a", false);
    assert.equal(r1.escalated, false);

    const r2 = router.recordResult("task-a", false);
    assert.equal(r2.escalated, true);
    assert.equal(r2.tier, "standard");
  });

  it("escalates from standard to frontier on more failures", () => {
    const router = new TierRouter();

    // Escalate to standard
    router.recordResult("task-b", false);
    router.recordResult("task-b", false);

    // Escalate to frontier
    router.recordResult("task-b", false);
    const r = router.recordResult("task-b", false);
    assert.equal(r.escalated, true);
    assert.equal(r.tier, "frontier");
  });

  it("signals terminal state at frontier", () => {
    const router = new TierRouter();

    // Escalate to frontier
    router.recordResult("task-c", false);
    router.recordResult("task-c", false); // → standard
    router.recordResult("task-c", false);
    router.recordResult("task-c", false); // → frontier

    // More failures at frontier
    router.recordResult("task-c", false);
    const r = router.recordResult("task-c", false);
    assert.equal(r.escalated, false);
    assert.equal(r.tier, "frontier");
  });

  it("resets failure counter on success", () => {
    const router = new TierRouter();

    router.recordResult("task-d", false); // 1 failure
    router.recordResult("task-d", true);  // reset
    router.recordResult("task-d", false); // 1 failure (not 2)
    const r = router.recordResult("task-d", false); // 2 failures → escalate

    assert.equal(r.escalated, true);
  });

  it("uses override tier in routing decisions", () => {
    const router = new TierRouter();

    // Escalate to standard
    router.recordResult("task-e", false);
    router.recordResult("task-e", false);

    const decision = router.route("task-e", { changedFiles: 1, toolDependencies: 0, nestingDepth: 0 });
    assert.equal(decision.tier, "standard"); // Override, not frugal
    assert.equal(decision.escalated, true);
  });
});

// ═══ 3. Downgrade ═════════════════════════════════════════════════════

describe("downgrade", () => {
  it("downgrades after 2 consecutive successes", () => {
    const router = new TierRouter();

    // Escalate to standard
    router.recordResult("task-f", false);
    router.recordResult("task-f", false);
    assert.equal(router.currentTier("task-f"), "standard");

    // Downgrade back
    router.recordResult("task-f", true);
    const r = router.recordResult("task-f", true);
    assert.equal(r.escalated, false);
    assert.equal(router.currentTier("task-f"), "frugal");
  });

  it("does not downgrade below base tier", () => {
    const router = new TierRouter();

    // Escalate to standard then downgrade
    router.recordResult("task-g", false);
    router.recordResult("task-g", false);
    router.recordResult("task-g", true);
    router.recordResult("task-g", true);

    // Further successes should not cause issues
    router.recordResult("task-g", true);
    router.recordResult("task-g", true);

    assert.equal(router.currentTier("task-g"), null); // Back to base
  });
});

// ═══ 4. Reset ═════════════════════════════════════════════════════════

describe("reset", () => {
  it("clears all state", () => {
    const router = new TierRouter();

    router.recordResult("task-h", false);
    router.recordResult("task-h", false);
    assert.equal(router.currentTier("task-h"), "standard");

    router.reset();
    assert.equal(router.currentTier("task-h"), null);
  });
});
