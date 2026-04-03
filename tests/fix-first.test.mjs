#!/usr/bin/env node
/**
 * Fix-First Heuristic Tests — FIX-1 + FIX-2
 *
 * Run: node --test tests/fix-first.test.mjs
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  classifyFinding,
  classifyFindings,
  dispatchAutoFix,
} from "../dist/platform/bus/fix-first.js";

// ═══ 1. classifyFinding ═════════════════════════════════

describe("classifyFinding", () => {
  it("info → auto-fix", () => {
    assert.equal(classifyFinding({ severity: "info" }), "auto-fix");
  });

  it("low → auto-fix", () => {
    assert.equal(classifyFinding({ severity: "low" }), "auto-fix");
  });

  it("medium → review", () => {
    assert.equal(classifyFinding({ severity: "medium" }), "review");
  });

  it("high → block", () => {
    assert.equal(classifyFinding({ severity: "high" }), "block");
  });

  it("critical → block", () => {
    assert.equal(classifyFinding({ severity: "critical" }), "block");
  });

  it("unknown severity → block (fail-safe)", () => {
    assert.equal(classifyFinding({ severity: "bizarre" }), "block");
  });

  it("custom severityMap override", () => {
    assert.equal(classifyFinding({ severity: "low" }, { low: "review" }), "review");
  });
});

// ═══ 2. classifyFindings ════════════════════════════════

describe("classifyFindings", () => {
  it("groups findings correctly", () => {
    const findings = [
      { severity: "info", message: "a" },
      { severity: "low", message: "b" },
      { severity: "medium", message: "c" },
      { severity: "high", message: "d" },
      { severity: "critical", message: "e" },
    ];
    const { autoFixable, reviewRequired, blocking } = classifyFindings(findings);
    assert.equal(autoFixable.length, 2);
    assert.equal(reviewRequired.length, 1);
    assert.equal(blocking.length, 2);
  });

  it("union equals original", () => {
    const findings = [
      { severity: "info" },
      { severity: "medium" },
      { severity: "critical" },
    ];
    const { autoFixable, reviewRequired, blocking } = classifyFindings(findings);
    assert.equal(autoFixable.length + reviewRequired.length + blocking.length, findings.length);
  });

  it("empty input → empty groups", () => {
    const { autoFixable, reviewRequired, blocking } = classifyFindings([]);
    assert.equal(autoFixable.length, 0);
    assert.equal(reviewRequired.length, 0);
    assert.equal(blocking.length, 0);
  });
});

// ═══ 3. dispatchAutoFix ═════════════════════════════════

describe("dispatchAutoFix", () => {
  const successFixer = async () => true;
  const failFixer = async () => false;
  const throwFixer = async () => { throw new Error("crash"); };

  it("auto-fixes low severity findings", async () => {
    const findings = [
      { severity: "info", message: "lint issue" },
      { severity: "low", message: "style issue" },
    ];
    const results = await dispatchAutoFix(findings, successFixer);
    const fixed = results.filter(r => r.action === "fixed");
    assert.equal(fixed.length, 2);
  });

  it("skips blocking findings", async () => {
    const findings = [
      { severity: "high", message: "security issue" },
    ];
    const results = await dispatchAutoFix(findings, successFixer);
    assert.equal(results[0].action, "skipped");
    assert.ok(results[0].detail.includes("blocking"));
  });

  it("promotes excess auto-fixable to review", async () => {
    const findings = [
      { severity: "info", message: "a" },
      { severity: "info", message: "b" },
      { severity: "info", message: "c" },
    ];
    const results = await dispatchAutoFix(findings, successFixer, { maxAutoFixes: 2 });
    const promoted = results.filter(r => r.action === "promoted");
    assert.equal(promoted.length, 1);
  });

  it("dryRun mode — no fixer called", async () => {
    let fixerCalled = false;
    const findings = [{ severity: "low", message: "test" }];
    await dispatchAutoFix(findings, async () => { fixerCalled = true; return true; }, { dryRun: true });
    assert.ok(!fixerCalled);
  });

  it("fixer failure → failed result", async () => {
    const findings = [{ severity: "low", message: "test" }];
    const results = await dispatchAutoFix(findings, failFixer);
    assert.equal(results[0].action, "failed");
  });

  it("fixer throw → failed with error detail", async () => {
    const findings = [{ severity: "low", message: "test" }];
    const results = await dispatchAutoFix(findings, throwFixer);
    assert.equal(results[0].action, "failed");
    assert.ok(results[0].detail.includes("crash"));
  });

  it("mixed findings — correct routing", async () => {
    const findings = [
      { severity: "info", message: "auto" },
      { severity: "medium", message: "review" },
      { severity: "critical", message: "block" },
    ];
    const results = await dispatchAutoFix(findings, successFixer);
    assert.equal(results.filter(r => r.action === "fixed").length, 1);
    assert.equal(results.filter(r => r.action === "skipped").length, 2);
  });
});
