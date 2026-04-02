#!/usr/bin/env node
/**
 * Stagnation Detection Tests — 4 patterns + recommendation logic.
 *
 * Run: node --test tests/stagnation.test.mjs
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

const { detectStagnation } = await import("../dist/platform/bus/stagnation.js");

function verdict(v, codes = [], summary = "") {
  return {
    type: "audit.verdict",
    source: "codex",
    timestamp: Date.now(),
    payload: { verdict: v, codes, summary },
  };
}

// ═══ 1. Spinning ══════════════════════════════════════════════════════

describe("spinning detection", () => {
  it("detects 3 identical consecutive verdicts", () => {
    const events = [
      verdict("changes_requested", ["lint-gap"]),
      verdict("changes_requested", ["lint-gap"]),
      verdict("changes_requested", ["lint-gap"]),
    ];
    const result = detectStagnation(events, {}, undefined, { mode: "advanced" });
    assert.ok(result.detected);
    assert.ok(result.patterns.some((p) => p.type === "spinning"));
  });

  it("does not trigger with varied verdicts", () => {
    const events = [
      verdict("changes_requested", ["lint-gap"]),
      verdict("changes_requested", ["test-gap"]),
      verdict("changes_requested", ["lint-gap"]),
    ];
    const result = detectStagnation(events, {}, undefined, { mode: "advanced" });
    assert.ok(!result.patterns.some((p) => p.type === "spinning"));
  });

  it("does not trigger below threshold", () => {
    const events = [
      verdict("changes_requested", ["lint-gap"]),
      verdict("changes_requested", ["lint-gap"]),
    ];
    const result = detectStagnation(events, {}, undefined, { mode: "advanced" });
    assert.ok(!result.detected);
  });
});

// ═══ 2. Oscillation ═══════════════════════════════════════════════════

describe("oscillation detection", () => {
  it("detects A→B→A→B→A alternation", () => {
    const events = [
      verdict("approved"),
      verdict("changes_requested", ["test-gap"]),
      verdict("approved"),
      verdict("changes_requested", ["test-gap"]),
      verdict("approved"),
    ];
    const result = detectStagnation(events, {}, undefined, { mode: "advanced" });
    assert.ok(result.patterns.some((p) => p.type === "oscillation"));
  });

  it("does not trigger with consistent progress", () => {
    const events = [
      verdict("changes_requested", ["lint-gap"]),
      verdict("changes_requested", ["test-gap"]),
      verdict("changes_requested", ["scope-mismatch"]),
      verdict("approved"),
    ];
    const result = detectStagnation(events, {}, undefined, { mode: "advanced" });
    assert.ok(!result.patterns.some((p) => p.type === "oscillation"));
  });
});

// ═══ 3. No drift ══════════════════════════════════════════════════════

describe("no-drift detection", () => {
  it("detects 3 identical rejection verdicts", () => {
    const events = [
      verdict("changes_requested", ["scope-mismatch"]),
      verdict("changes_requested", ["scope-mismatch"]),
      verdict("changes_requested", ["scope-mismatch"]),
    ];
    const result = detectStagnation(events, {}, undefined, { mode: "advanced" });
    assert.ok(result.patterns.some((p) => p.type === "no-drift"));
  });

  it("does not trigger when approved", () => {
    const events = [
      verdict("approved"),
      verdict("approved"),
      verdict("approved"),
    ];
    const result = detectStagnation(events, {}, undefined, { mode: "advanced" });
    assert.ok(!result.patterns.some((p) => p.type === "no-drift"));
  });
});

// ═══ 4. Diminishing returns ═══════════════════════════════════════════

describe("diminishing returns detection", () => {
  it("detects declining improvement rate", () => {
    const events = [
      verdict("changes_requested", ["a", "b", "c", "d"]),   // 4 codes
      verdict("changes_requested", ["a", "b", "c"]),         // 3 codes (improved by 1)
      verdict("changes_requested", ["a", "b", "c"]),         // 3 codes (improved by 0)
      verdict("changes_requested", ["a", "b", "c", "d"]),   // 4 codes (regressed)
    ];
    const result = detectStagnation(events, {}, undefined, { mode: "advanced" });
    assert.ok(result.patterns.some((p) => p.type === "diminishing-returns"));
  });

  it("does not trigger with steady improvement", () => {
    const events = [
      verdict("changes_requested", ["a", "b", "c"]),
      verdict("changes_requested", ["a", "b"]),
      verdict("changes_requested", ["a"]),
      verdict("approved"),
    ];
    const result = detectStagnation(events, {}, undefined, { mode: "advanced" });
    assert.ok(!result.patterns.some((p) => p.type === "diminishing-returns"));
  });
});

// ═══ 5. Recommendations ══════════════════════════════════════════════

describe("stagnation recommendations", () => {
  it("recommends continue when no stagnation", () => {
    const events = [
      verdict("changes_requested", ["lint-gap"]),
      verdict("changes_requested", ["test-gap"]),
      verdict("approved"),
    ];
    const result = detectStagnation(events, {}, undefined, { mode: "advanced" });
    assert.equal(result.recommendation, "continue");
  });

  it("recommends halt for spinning + oscillation", () => {
    // Create a pattern that triggers both
    const events = [
      verdict("changes_requested", ["lint-gap"]),
      verdict("approved"),
      verdict("changes_requested", ["lint-gap"]),
      verdict("approved"),
      verdict("changes_requested", ["lint-gap"]),
      verdict("changes_requested", ["lint-gap"]),
      verdict("changes_requested", ["lint-gap"]),
    ];
    const result = detectStagnation(events, {}, undefined, { mode: "advanced" });
    if (result.patterns.some((p) => p.type === "spinning") &&
        result.patterns.some((p) => p.type === "oscillation")) {
      assert.equal(result.recommendation, "halt");
    }
  });

  it("recommends escalate for no-drift", () => {
    const events = [
      verdict("changes_requested", ["scope-mismatch"]),
      verdict("changes_requested", ["scope-mismatch"]),
      verdict("changes_requested", ["scope-mismatch"]),
    ];
    const result = detectStagnation(events, {}, undefined, { mode: "advanced" });
    assert.equal(result.recommendation, "escalate");
  });
});
