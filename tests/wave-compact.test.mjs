/**
 * Tests for Wave Compact + Forked Child Context (SDK-8).
 *
 * Verifies compact handoff and context fork adopted from Claude Code patterns.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

const compact = await import("../dist/platform/orchestrate/execution/wave-compact.js");
const fork = await import("../dist/platform/orchestrate/execution/context-fork.js");

// ═══ Wave Compact ══════════════════════════════════════

describe("Wave Compact — summary generation", () => {
  it("generates summary with all required fields", () => {
    const summary = compact.generateCompactSummary({
      waveIndex: 2,
      trackName: "SDK",
      changedFiles: ["a.ts", "b.ts"],
      fitness: 0.85,
      findings: [{ code: "type-safety", severity: "high", file: "a.ts", summary: "as any usage" }],
      waveFiles: ["a.ts", "b.ts", "c.ts"],
    });

    assert.equal(summary.waveIndex, 2);
    assert.equal(summary.trackName, "SDK");
    assert.deepEqual(summary.changedFiles, ["a.ts", "b.ts"]);
    assert.equal(summary.fitness, 0.85);
    assert.equal(summary.source, "generated");
    assert.ok(summary.generatedAt > 0);
  });

  it("limits topFiles to MAX_RESTORE_FILES", () => {
    const summary = compact.generateCompactSummary({
      waveIndex: 1,
      trackName: "test",
      changedFiles: Array.from({ length: 20 }, (_, i) => `file${i}.ts`),
      fitness: 0.7,
      findings: [],
      waveFiles: Array.from({ length: 20 }, (_, i) => `file${i}.ts`),
    });

    assert.ok(summary.topFiles.length <= compact.MAX_RESTORE_FILES);
  });

  it("limits findings to MAX_FINDINGS", () => {
    const findings = Array.from({ length: 20 }, (_, i) => ({
      code: `code-${i}`, severity: /** @type {const} */ ("medium"), summary: `finding ${i}`,
    }));

    const summary = compact.generateCompactSummary({
      waveIndex: 1,
      trackName: "test",
      changedFiles: ["a.ts"],
      fitness: 0.5,
      findings,
      waveFiles: ["a.ts"],
    });

    assert.ok(summary.unresolvedFindings.length <= compact.MAX_FINDINGS);
  });

  it("sorts findings by severity (high first)", () => {
    const summary = compact.generateCompactSummary({
      waveIndex: 1,
      trackName: "test",
      changedFiles: ["a.ts"],
      fitness: 0.6,
      findings: [
        { code: "low1", severity: "low", summary: "low" },
        { code: "high1", severity: "high", summary: "critical" },
        { code: "med1", severity: "medium", summary: "medium" },
      ],
      waveFiles: ["a.ts"],
    });

    assert.equal(summary.unresolvedFindings[0].severity, "high");
    assert.equal(summary.unresolvedFindings[1].severity, "medium");
    assert.equal(summary.unresolvedFindings[2].severity, "low");
  });

  it("prioritizes changed files in topFiles ranking", () => {
    const summary = compact.generateCompactSummary({
      waveIndex: 1,
      trackName: "test",
      changedFiles: ["changed.ts"],
      fitness: 0.8,
      findings: [
        { code: "c1", severity: "high", file: "other.ts", summary: "issue" },
        { code: "c2", severity: "high", file: "other.ts", summary: "issue" },
      ],
      waveFiles: ["changed.ts", "other.ts", "third.ts"],
    });

    assert.equal(summary.topFiles[0].path, "changed.ts");
  });
});

describe("Wave Compact — fallback summary", () => {
  it("generates minimal fallback with changed files", () => {
    const summary = compact.generateFallbackSummary(3, "SDK", ["x.ts"], 0.6);
    assert.equal(summary.source, "fallback");
    assert.equal(summary.waveIndex, 3);
    assert.deepEqual(summary.changedFiles, ["x.ts"]);
    assert.equal(summary.unresolvedFindings.length, 0);
  });
});

describe("Wave Compact — formatCompactContext", () => {
  it("formats summary as markdown context section", () => {
    const summary = compact.generateCompactSummary({
      waveIndex: 1,
      trackName: "SDK",
      changedFiles: ["a.ts"],
      fitness: 0.82,
      findings: [{ code: "missing-test", severity: "medium", file: "a.ts", summary: "No unit test" }],
      waveFiles: ["a.ts"],
      constraints: ["Do not modify public API"],
    });

    const formatted = compact.formatCompactContext(summary);
    assert.ok(formatted.includes("Previous Wave Context"));
    assert.ok(formatted.includes("Fitness:"));
    assert.ok(formatted.includes("Unresolved Findings"));
    assert.ok(formatted.includes("missing-test"));
    assert.ok(formatted.includes("Key Files to Review"));
    assert.ok(formatted.includes("Constraints"));
    assert.ok(formatted.includes("Do not modify public API"));
  });
});

describe("Wave Compact — circuit breaker", () => {
  it("starts with 0 failures", () => {
    const breaker = compact.createCircuitBreaker();
    assert.equal(breaker.failures, 0);
    assert.equal(breaker.tripped, false);
  });

  it("trips after CIRCUIT_BREAKER_THRESHOLD consecutive failures", () => {
    let breaker = compact.createCircuitBreaker();
    for (let i = 0; i < compact.CIRCUIT_BREAKER_THRESHOLD; i++) {
      breaker = compact.recordFailure(breaker, `error ${i}`);
    }
    assert.equal(breaker.tripped, true);
    assert.equal(breaker.failures, compact.CIRCUIT_BREAKER_THRESHOLD);
  });

  it("does not trip before threshold", () => {
    let breaker = compact.createCircuitBreaker();
    breaker = compact.recordFailure(breaker, "err1");
    assert.equal(breaker.tripped, false);
  });

  it("success resets failure count", () => {
    let breaker = compact.createCircuitBreaker();
    breaker = compact.recordFailure(breaker, "err1");
    breaker = compact.recordFailure(breaker, "err2");
    breaker = compact.recordSuccess(breaker);
    assert.equal(breaker.failures, 0);
    assert.equal(breaker.tripped, false);
  });
});

// ═══ Forked Child Context ══════════════════════════════

describe("Context Fork — parent creation", () => {
  it("creates frozen parent context", () => {
    const parent = fork.createParentContext({
      waveIndex: 1,
      trackName: "SDK",
      fitness: 0.8,
      changedFiles: ["a.ts"],
      detectedDomains: ["perf"],
    });

    assert.equal(parent.waveIndex, 1);
    assert.ok(Object.isFrozen(parent.changedFiles));
    assert.ok(Object.isFrozen(parent.detectedDomains));
    assert.ok(Object.isFrozen(parent.frozen));
  });
});

describe("Context Fork — child isolation", () => {
  it("child overlay is independent from parent", () => {
    const parent = fork.createParentContext({
      waveIndex: 1, trackName: "test", fitness: 0.8,
      changedFiles: ["a.ts"], extra: { key: "parentValue" },
    });

    const child = fork.forkChild(parent, "child-1");
    fork.childAddFile(child, "b.ts");
    fork.childAddFinding(child, { code: "test", severity: "low", summary: "test finding" });
    fork.childSetState(child, "key", "childValue");

    // Parent unchanged
    assert.ok(!parent.changedFiles.includes("b.ts"));
    assert.equal(parent.frozen.key, "parentValue");

    // Child has its own state
    assert.ok(child.overlay.changedFiles.includes("b.ts"));
    assert.equal(fork.childGetState(child, "key"), "childValue");
  });

  it("siblings don't see each other's mutations", () => {
    const parent = fork.createParentContext({
      waveIndex: 1, trackName: "test", fitness: 0.7,
      changedFiles: [],
    });

    const childA = fork.forkChild(parent, "A");
    const childB = fork.forkChild(parent, "B");

    fork.childAddFile(childA, "a-only.ts");
    fork.childAddFile(childB, "b-only.ts");
    fork.childSetState(childA, "x", 1);
    fork.childSetState(childB, "x", 2);

    assert.ok(!childA.overlay.changedFiles.includes("b-only.ts"));
    assert.ok(!childB.overlay.changedFiles.includes("a-only.ts"));
    assert.equal(fork.childGetState(childA, "x"), 1);
    assert.equal(fork.childGetState(childB, "x"), 2);
  });

  it("childGetState falls back to parent frozen state", () => {
    const parent = fork.createParentContext({
      waveIndex: 1, trackName: "test", fitness: 0.8,
      changedFiles: [], extra: { inherited: "yes" },
    });

    const child = fork.forkChild(parent, "c1");
    assert.equal(fork.childGetState(child, "inherited"), "yes");
  });

  it("childAddFile is idempotent", () => {
    const parent = fork.createParentContext({
      waveIndex: 1, trackName: "test", fitness: 0.8, changedFiles: [],
    });
    const child = fork.forkChild(parent, "c1");
    fork.childAddFile(child, "same.ts");
    fork.childAddFile(child, "same.ts");
    assert.equal(child.overlay.changedFiles.length, 1);
  });
});

describe("Context Fork — collectChildren", () => {
  it("collects changed files and findings from all children", () => {
    const parent = fork.createParentContext({
      waveIndex: 1, trackName: "test", fitness: 0.8, changedFiles: [],
    });

    const c1 = fork.forkChild(parent, "w1");
    const c2 = fork.forkChild(parent, "w2");
    fork.childAddFile(c1, "a.ts");
    fork.childAddFile(c2, "b.ts");
    fork.childAddFile(c2, "a.ts"); // duplicate
    fork.childAddFinding(c1, { code: "x", severity: "high", summary: "f1" });
    fork.childAddFinding(c2, { code: "y", severity: "low", summary: "f2" });

    const result = fork.collectChildren([c1, c2]);
    assert.deepEqual(result.allChangedFiles, ["a.ts", "b.ts"]); // deduped + sorted
    assert.equal(result.allFindings.length, 2);
    assert.equal(result.allFindings[0].childId, "w1");
    assert.equal(result.allFindings[1].childId, "w2");
  });

  it("marks children as merged", () => {
    const parent = fork.createParentContext({
      waveIndex: 1, trackName: "test", fitness: 0.8, changedFiles: [],
    });
    const c1 = fork.forkChild(parent, "w1");
    assert.equal(c1.merged, false);

    fork.collectChildren([c1]);
    assert.equal(c1.merged, true);
  });
});
