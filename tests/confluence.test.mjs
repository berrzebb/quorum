#!/usr/bin/env node
/**
 * Confluence Verification Tests — post-audit whole-system integrity checks.
 *
 * Tests:
 *   1. Law-Code check (audit verdict alignment)
 *   2. Part-Whole check (integration test results)
 *   3. Intent-Result check (CPS gap detection)
 *   4. Law-Law check (contradiction detection)
 *   5. Full verifyConfluence() — all passing / partial failure
 *
 * Run: node --test tests/confluence.test.mjs
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

const { verifyConfluence } = await import("../dist/bus/confluence.js");

// ═══ 1. Law ↔ Code ═══════════════════════════════════════════════════════

describe("Law-Code check", () => {
  it("audit approved → check passed", () => {
    const result = verifyConfluence({ auditVerdict: "approved" });
    const lawCode = result.checks.find(c => c.type === "law-code");
    assert.ok(lawCode);
    assert.equal(lawCode.passed, true);
    assert.equal(lawCode.severity, "info");
  });

  it("changes_requested → check failed", () => {
    const result = verifyConfluence({ auditVerdict: "changes_requested" });
    const lawCode = result.checks.find(c => c.type === "law-code");
    assert.ok(lawCode);
    assert.equal(lawCode.passed, false);
    assert.equal(lawCode.severity, "error");
  });
});

// ═══ 2. Part ↔ Whole ═════════════════════════════════════════════════════

describe("Part-Whole check", () => {
  it("integration tests passed → check passed", () => {
    const result = verifyConfluence({ integrationTestsPassed: true });
    const partWhole = result.checks.find(c => c.type === "part-whole");
    assert.ok(partWhole);
    assert.equal(partWhole.passed, true);
    assert.equal(partWhole.severity, "info");
  });

  it("integration tests failed → check failed with error severity", () => {
    const result = verifyConfluence({
      integrationTestsPassed: false,
      integrationFailures: 3,
    });
    const partWhole = result.checks.find(c => c.type === "part-whole");
    assert.ok(partWhole);
    assert.equal(partWhole.passed, false);
    assert.equal(partWhole.severity, "error");
    assert.ok(partWhole.detail.includes("3 failures"));
  });
});

// ═══ 3. Intent ↔ Result ══════════════════════════════════════════════════

describe("Intent-Result check", () => {
  it("CPS with gaps + audit approved → warning", () => {
    const result = verifyConfluence({
      auditVerdict: "approved",
      cps: {
        context: "test context",
        problem: "test problem",
        solution: "test solution",
        sourceLogIds: [],
        gaps: [{ item: "missing feature", classification: "gap", action: "implement" }],
        builds: [{ item: "core module", classification: "build", action: "build" }],
        generatedAt: Date.now(),
      },
    });
    const intentResult = result.checks.find(c => c.type === "intent-result");
    assert.ok(intentResult);
    assert.equal(intentResult.passed, false);
    assert.equal(intentResult.severity, "warning");
    assert.ok(intentResult.detail.includes("1 unresolved gaps"));
  });
});

// ═══ 4. Law ↔ Law ════════════════════════════════════════════════════════

describe("Law-Law check", () => {
  it("contradictions provided → check failed", () => {
    const result = verifyConfluence({
      lawContradictions: ["rule A conflicts with rule B"],
    });
    const lawLaw = result.checks.find(c => c.type === "law-law");
    assert.ok(lawLaw);
    assert.equal(lawLaw.passed, false);
    assert.equal(lawLaw.severity, "error");
    assert.ok(lawLaw.detail.includes("rule A conflicts with rule B"));
  });
});

// ═══ 5. Full verifyConfluence() ══════════════════════════════════════════

describe("verifyConfluence()", () => {
  it("all passing → result.passed = true", () => {
    const result = verifyConfluence({
      auditVerdict: "approved",
      integrationTestsPassed: true,
      lawContradictions: [],
    });
    assert.equal(result.passed, true);
    assert.equal(result.checks.length, 4);
    assert.equal(result.suggestedAmendments.length, 0);
    assert.ok(result.timestamp > 0);
  });

  it("part-whole failure → suggestedAmendments.length > 0", () => {
    const result = verifyConfluence({
      auditVerdict: "approved",
      integrationTestsPassed: false,
      integrationFailures: 5,
    });
    assert.equal(result.passed, false);
    assert.ok(result.suggestedAmendments.length > 0);

    const amendment = result.suggestedAmendments.find(a => a.source === "part-whole");
    assert.ok(amendment);
    assert.equal(amendment.target, "wb");
  });
});
