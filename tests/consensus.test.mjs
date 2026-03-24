#!/usr/bin/env node
/**
 * Deliberative Consensus + Trigger Tests
 *
 * Run: node --test tests/consensus.test.mjs
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

const { DeliberativeConsensus } = await import("../dist/providers/consensus.js");
const { evaluateTrigger } = await import("../dist/providers/trigger.js");

// ═══ Mock auditors ════════════════════════════════════════════════════

function mockAuditor(verdict, summary = "", codes = []) {
  return {
    async audit(request) {
      const raw = JSON.stringify({
        verdict,
        reasoning: summary,
        summary,
        codes,
        confidence: verdict === "approved" ? 0.9 : 0.8,
      });
      return { verdict, codes, summary, raw, duration: 10 };
    },
    async available() { return true; },
  };
}

// ═══ 1. Deliberative Consensus ════════════════════════════════════════

describe("DeliberativeConsensus", () => {
  it("approves when all 3 roles agree", async () => {
    const consensus = new DeliberativeConsensus({
      advocate: mockAuditor("approved", "Code is solid"),
      devil: mockAuditor("approved", "No issues found"),
      judge: mockAuditor("approved", "Both agree, approved"),
    });

    const result = await consensus.run({
      evidence: "test evidence",
      prompt: "review this",
      files: ["a.ts"],
    });

    assert.equal(result.mode, "deliberative");
    assert.equal(result.finalVerdict, "approved");
    assert.equal(result.opinions.length, 2);
    assert.ok(result.judgeSummary.includes("approved") || result.judgeSummary.includes("agree"));
    assert.ok(result.duration >= 0);
  });

  it("rejects when judge sides with devil's advocate", async () => {
    const consensus = new DeliberativeConsensus({
      advocate: mockAuditor("approved", "Looks fine"),
      devil: mockAuditor("changes_requested", "Root cause not addressed", ["principle-drift"]),
      judge: mockAuditor("changes_requested", "Devil has a point", ["principle-drift"]),
    });

    const result = await consensus.run({
      evidence: "test evidence",
      prompt: "review this",
      files: ["a.ts"],
    });

    assert.equal(result.finalVerdict, "changes_requested");
    assert.equal(result.opinions[0].role, "advocate");
    assert.equal(result.opinions[1].role, "devil");
  });

  it("handles parse errors gracefully", async () => {
    const brokenAuditor = {
      async audit() {
        return { verdict: "approved", codes: [], summary: "", raw: "NOT JSON", duration: 1 };
      },
      async available() { return true; },
    };

    const consensus = new DeliberativeConsensus({
      advocate: brokenAuditor,
      devil: brokenAuditor,
      judge: mockAuditor("changes_requested", "Cannot determine"),
    });

    const result = await consensus.run({
      evidence: "test",
      prompt: "review",
      files: [],
    });

    // Parse-error opinions should default to changes_requested
    assert.equal(result.opinions[0].codes[0], "parse-error");
    assert.equal(result.opinions[1].codes[0], "parse-error");
  });

  it("runSimple() uses single auditor without deliberation", async () => {
    const consensus = new DeliberativeConsensus({
      advocate: mockAuditor("approved", "All good"),
      devil: mockAuditor("changes_requested"),
      judge: mockAuditor("changes_requested"),
    });

    const result = await consensus.runSimple({
      evidence: "test",
      prompt: "review",
      files: ["a.ts"],
    });

    assert.equal(result.mode, "simple");
    assert.equal(result.finalVerdict, "approved");
    assert.equal(result.opinions.length, 1);
  });
});

// ═══ 2. Trigger evaluation ════════════════════════════════════════════

describe("evaluateTrigger", () => {
  it("T1 skip for micro changes (1-2 files, no risk)", () => {
    const result = evaluateTrigger({
      changedFiles: 1,
      securitySensitive: false,
      priorRejections: 0,
      apiSurfaceChanged: false,
      crossLayerChange: false,
      isRevert: false,
    });
    assert.equal(result.tier, "T1");
    assert.equal(result.mode, "skip");
    assert.ok(result.score < 0.3);
  });

  it("T2 simple for standard changes", () => {
    const result = evaluateTrigger({
      changedFiles: 5,
      securitySensitive: false,
      priorRejections: 1,
      apiSurfaceChanged: false,
      crossLayerChange: false,
      isRevert: false,
    });
    assert.equal(result.tier, "T2");
    assert.equal(result.mode, "simple");
  });

  it("T3 deliberative for security-sensitive + large scope", () => {
    const result = evaluateTrigger({
      changedFiles: 10,
      securitySensitive: true,
      priorRejections: 0,
      apiSurfaceChanged: true,
      crossLayerChange: false,
      isRevert: false,
    });
    assert.equal(result.tier, "T3");
    assert.equal(result.mode, "deliberative");
    assert.ok(result.score >= 0.7);
  });

  it("escalates on repeated rejections", () => {
    const result = evaluateTrigger({
      changedFiles: 4,
      securitySensitive: true,
      priorRejections: 3,
      apiSurfaceChanged: true,
      crossLayerChange: false,
      isRevert: false,
    });
    assert.equal(result.tier, "T3");
    assert.ok(result.reasons.some(r => r.includes("rejection")));
  });

  it("discounts score for reverts", () => {
    const withRevert = evaluateTrigger({
      changedFiles: 5,
      securitySensitive: true,
      priorRejections: 0,
      apiSurfaceChanged: false,
      crossLayerChange: false,
      isRevert: true,
    });

    const withoutRevert = evaluateTrigger({
      changedFiles: 5,
      securitySensitive: true,
      priorRejections: 0,
      apiSurfaceChanged: false,
      crossLayerChange: false,
      isRevert: false,
    });

    assert.ok(withRevert.score < withoutRevert.score);
    assert.ok(withRevert.reasons.some(r => r.includes("revert")));
  });

  it("cross-layer change adds risk", () => {
    const result = evaluateTrigger({
      changedFiles: 6,
      securitySensitive: true,
      priorRejections: 1,
      apiSurfaceChanged: true,
      crossLayerChange: true,
      isRevert: false,
    });
    assert.ok(result.score >= 0.7);
    assert.equal(result.tier, "T3");
  });

  it("plan-first: large change without plan doc increases score", () => {
    const withPlan = evaluateTrigger({
      changedFiles: 8,
      securitySensitive: false,
      priorRejections: 0,
      apiSurfaceChanged: false,
      crossLayerChange: false,
      isRevert: false,
      hasPlanDoc: true,
    });
    const withoutPlan = evaluateTrigger({
      changedFiles: 8,
      securitySensitive: false,
      priorRejections: 0,
      apiSurfaceChanged: false,
      crossLayerChange: false,
      isRevert: false,
      hasPlanDoc: false,
    });
    assert.ok(withoutPlan.score > withPlan.score);
    assert.ok(withoutPlan.reasons.some(r => r.includes("plan")));
  });

  it("plan-first: requiresPlan is true for T3 without plan doc", () => {
    const result = evaluateTrigger({
      changedFiles: 10,
      securitySensitive: true,
      priorRejections: 2,
      apiSurfaceChanged: true,
      crossLayerChange: false,
      isRevert: false,
      hasPlanDoc: false,
    });
    assert.equal(result.tier, "T3");
    assert.equal(result.requiresPlan, true);
  });

  it("plan-first: requiresPlan is false when plan doc exists", () => {
    const result = evaluateTrigger({
      changedFiles: 10,
      securitySensitive: true,
      priorRejections: 2,
      apiSurfaceChanged: true,
      crossLayerChange: false,
      isRevert: false,
      hasPlanDoc: true,
    });
    assert.equal(result.requiresPlan, false);
  });

  it("plan-first: small changes do not require plan", () => {
    const result = evaluateTrigger({
      changedFiles: 2,
      securitySensitive: false,
      priorRejections: 0,
      apiSurfaceChanged: false,
      crossLayerChange: false,
      isRevert: false,
      hasPlanDoc: false,
    });
    assert.equal(result.requiresPlan, false);
  });
});
