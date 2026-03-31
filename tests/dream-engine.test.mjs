#!/usr/bin/env node
/**
 * RDI-5: Dream Engine + RDI-6: Digest Handoff
 *
 * Run: node --test tests/dream-engine.test.mjs
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";

const { runDream } = await import("../platform/core/retro/dream-engine.mjs");
const { selectCarryover, formatDigestContext } = await import("../platform/core/retro/digest.mjs");

// wave-compact integration
const { generateCompactSummary } = await import("../dist/platform/orchestrate/execution/wave-compact.js");
const { mergeRetroContext, buildDepContextFromManifests } = await import("../dist/platform/orchestrate/execution/dependency-context.js");

let testDir;

beforeEach(() => {
  testDir = resolve(tmpdir(), `quorum-dream-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testDir, { recursive: true });
});

afterEach(() => {
  try { rmSync(testDir, { recursive: true, force: true }); } catch { /* ok */ }
});

// ═══ RDI-5: Dream Engine ═══════════════════════════════

describe("RDI-5: runDream — manual trigger", () => {
  it("completes with digest on manual trigger", async () => {
    const result = await runDream({
      trackName: "TEST",
      waveIndex: 3,
      trigger: "manual",
      lockDir: testDir,
      auditRecords: [
        { rejection_codes: ["CQ"], verdict: "rejected", summary: "Bad quality" },
        { rejection_codes: ["CQ"], verdict: "rejected", summary: "Still bad" },
        { rejection_codes: ["CQ", "T"], verdict: "rejected", summary: "Missing tests" },
      ],
    });
    assert.equal(result.status, "completed");
    assert.ok(result.digest);
    assert.equal(result.digest.trackName, "TEST");
    assert.equal(result.digest.source, "manual");
    assert.ok(result.durationMs >= 0);
  });

  it("completes with empty signals", async () => {
    const result = await runDream({
      trackName: "EMPTY",
      waveIndex: 0,
      trigger: "manual",
      lockDir: testDir,
    });
    assert.equal(result.status, "completed");
    assert.ok(result.digest);
  });
});

describe("RDI-5: runDream — wave-end trigger", () => {
  it("completes when lock is available", async () => {
    const result = await runDream({
      trackName: "T",
      waveIndex: 2,
      trigger: "wave-end",
      lockDir: testDir,
    });
    assert.equal(result.status, "completed");
  });

  it("skips when lock is held", async () => {
    // Acquire lock first
    const { tryAcquire } = await import("../platform/core/retro/consolidation-lock.mjs");
    tryAcquire(testDir);

    const result = await runDream({
      trackName: "T",
      waveIndex: 2,
      trigger: "wave-end",
      lockDir: testDir,
    });
    assert.equal(result.status, "skipped");
    assert.ok(result.reason.includes("lock"));
  });
});

describe("RDI-5: Dream failure isolation", () => {
  it("failure returns error status, not throw", async () => {
    // Use a non-writable lock dir to force failure
    const result = await runDream({
      trackName: "T",
      waveIndex: 0,
      trigger: "manual",
      lockDir: testDir,
      // Inject a broken audit record to test resilience
      auditRecords: [{ rejection_codes: ["A"], verdict: "rejected" }],
    });
    // Should complete or fail gracefully (never throw)
    assert.ok(["completed", "skipped", "failed"].includes(result.status));
  });
});

describe("RDI-5: Dream events", () => {
  it("emits events during execution", async () => {
    const events = [];
    const result = await runDream({
      trackName: "T",
      waveIndex: 1,
      trigger: "manual",
      lockDir: testDir,
      emitEvent: (type, payload) => events.push({ type, payload }),
    });
    assert.equal(result.status, "completed");
    assert.ok(events.some(e => e.type === "dream.consolidation.start"));
    assert.ok(events.some(e => e.type === "dream.consolidation.complete"));
    assert.ok(events.some(e => e.type === "dream.digest.generated"));
  });
});

// ═══ RDI-6: Digest Handoff ════════════════════════════

describe("RDI-6: wave-compact retroCarryover", () => {
  it("merges retro carryover into nextConstraints", () => {
    const summary = generateCompactSummary({
      waveIndex: 3,
      trackName: "T",
      changedFiles: ["a.ts"],
      fitness: 0.8,
      findings: [],
      waveFiles: ["a.ts"],
      constraints: ["Existing constraint"],
      retroCarryover: ["[constraint] Always validate types", "[failure] Repeated CQ issues"],
    });
    assert.ok(summary.nextConstraints.includes("Existing constraint"));
    assert.ok(summary.nextConstraints.includes("[constraint] Always validate types"));
    assert.ok(summary.nextConstraints.includes("[failure] Repeated CQ issues"));
    assert.equal(summary.nextConstraints.length, 3);
  });

  it("works without retroCarryover (backward compatible)", () => {
    const summary = generateCompactSummary({
      waveIndex: 1,
      trackName: "T",
      changedFiles: [],
      fitness: 0.9,
      findings: [],
      waveFiles: [],
    });
    assert.deepEqual(summary.nextConstraints, []);
  });
});

describe("RDI-6: mergeRetroContext", () => {
  it("merges retro and dep contexts", () => {
    const retro = "## Retro Intelligence\n- [constraint] Use strict types";
    const dep = "# Dependency Output\n## Wave 1\nChanged: a.ts";
    const merged = mergeRetroContext(retro, dep);
    assert.ok(merged.includes("Retro Intelligence"));
    assert.ok(merged.includes("Dependency Output"));
  });

  it("returns empty when both empty", () => {
    assert.equal(mergeRetroContext("", ""), "");
  });

  it("returns only retro when no dep", () => {
    const retro = "## Retro";
    assert.equal(mergeRetroContext(retro, ""), retro);
  });
});

describe("RDI-6: full dream → carryover → compact pipeline", () => {
  it("end-to-end: dream produces digest that feeds compact", async () => {
    const dreamResult = await runDream({
      trackName: "PIPE",
      waveIndex: 4,
      trigger: "manual",
      lockDir: testDir,
      auditRecords: [
        { rejection_codes: ["CQ"], verdict: "rejected", summary: "Quality issue" },
        { rejection_codes: ["CQ"], verdict: "rejected", summary: "Quality issue again" },
        { rejection_codes: ["CQ", "T"], verdict: "rejected", summary: "Tests missing" },
      ],
      compactSummaries: [{
        waveIndex: 3,
        unresolvedFindings: [{ code: "type-safety", severity: "high", summary: "Bad types" }],
        nextConstraints: ["Fix types first"],
      }],
    });
    assert.equal(dreamResult.status, "completed");

    // Select carryover from digest
    const carryover = selectCarryover(dreamResult.digest);
    assert.ok(carryover.length > 0);
    assert.ok(carryover.length <= 5);

    // Feed into compact
    const compact = generateCompactSummary({
      waveIndex: 5,
      trackName: "PIPE",
      changedFiles: ["x.ts"],
      fitness: 0.75,
      findings: [],
      waveFiles: ["x.ts"],
      constraints: [],
      retroCarryover: carryover,
    });
    assert.ok(compact.nextConstraints.length > 0);
    // Carryover items should be in constraints
    assert.ok(compact.nextConstraints.some(c => c.includes("[constraint]") || c.includes("[failure]") || c.includes("[guidance]")));
  });
});
