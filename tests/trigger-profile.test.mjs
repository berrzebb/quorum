/**
 * Tests: Profile-Aware Trigger (WB-4)
 * PRD § 6.3 — single threshold + fixed audit tier per profile.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const { evaluateTrigger, getThresholdForProfile, getProfileSpec } = await import(
  "../dist/platform/providers/trigger.js"
);

/** Contexts that produce known score ranges. */
const minimal = { changedFiles: 1, securitySensitive: false, priorRejections: 0, apiSurfaceChanged: false, crossLayerChange: false, isRevert: false };
const moderate = { ...minimal, changedFiles: 5, apiSurfaceChanged: true };
const heavy = { ...minimal, changedFiles: 12, securitySensitive: true, apiSurfaceChanged: true, crossLayerChange: true };

describe("getThresholdForProfile (PRD § 6.3)", () => {
  it("strict: 0.3", () => assert.equal(getThresholdForProfile("strict"), 0.3));
  it("balanced: 0.5", () => assert.equal(getThresholdForProfile("balanced"), 0.5));
  it("fast: 0.7", () => assert.equal(getThresholdForProfile("fast"), 0.7));
  it("prototype: 0.9", () => assert.equal(getThresholdForProfile("prototype"), 0.9));
  it("undefined → balanced (0.5)", () => assert.equal(getThresholdForProfile(undefined), 0.5));
});

describe("getProfileSpec", () => {
  it("strict → T3 deliberative", () => {
    const s = getProfileSpec("strict");
    assert.equal(s.auditTier, "T3");
    assert.equal(s.auditMode, "deliberative");
  });
  it("balanced → T2 simple", () => {
    const s = getProfileSpec("balanced");
    assert.equal(s.auditTier, "T2");
    assert.equal(s.auditMode, "simple");
  });
  it("fast → T1 skip", () => {
    const s = getProfileSpec("fast");
    assert.equal(s.auditTier, "T1");
    assert.equal(s.auditMode, "skip");
  });
  it("prototype → T1 skip", () => {
    const s = getProfileSpec("prototype");
    assert.equal(s.auditTier, "T1");
    assert.equal(s.auditMode, "skip");
  });
});

describe("evaluateTrigger with gateProfile (PRD § 6.3)", () => {
  it("no profile → backward compat (balanced defaults)", () => {
    const r = evaluateTrigger(minimal);
    // score ~0.1 < balanced threshold 0.5 → T1 skip
    assert.equal(r.tier, "T1");
    assert.equal(r.mode, "skip");
  });

  it("strict: low score still triggers T3 (threshold 0.3)", () => {
    // moderate: score ~0.4 >= strict threshold 0.3 → T3
    const r = evaluateTrigger(moderate, undefined, "strict");
    assert.equal(r.tier, "T3");
    assert.equal(r.mode, "deliberative");
  });

  it("balanced: moderate score triggers T2 (threshold 0.5)", () => {
    // heavy: score well above 0.5 → T2
    const r = evaluateTrigger(heavy, undefined, "balanced");
    assert.equal(r.tier, "T2");
    assert.equal(r.mode, "simple");
  });

  it("fast: moderate score stays T1 skip (threshold 0.7)", () => {
    // moderate score ~0.4 < fast threshold 0.7 → T1 skip
    const r = evaluateTrigger(moderate, undefined, "fast");
    assert.equal(r.tier, "T1");
    assert.equal(r.mode, "skip");
  });

  it("prototype: heavy score still may skip (threshold 0.9)", () => {
    const r = evaluateTrigger(heavy, undefined, "prototype");
    // heavy score is ~0.8-1.0, threshold is 0.9
    // If score < 0.9 → skip, if >= 0.9 → T1 skip anyway
    assert.equal(r.mode, "skip");
  });

  it("strict: minimal change below threshold → still skip", () => {
    // minimal score ~0.1 < strict threshold 0.3 → skip
    const r = evaluateTrigger(minimal, undefined, "strict");
    assert.equal(r.tier, "T1");
    assert.equal(r.mode, "skip");
  });

  it("score is identical regardless of profile (only tier mapping changes)", () => {
    const s1 = evaluateTrigger(moderate, undefined, "strict");
    const s2 = evaluateTrigger(moderate, undefined, "fast");
    assert.equal(s1.score, s2.score);
  });

  it("strict always maps to T3 when triggered", () => {
    const r = evaluateTrigger(heavy, undefined, "strict");
    assert.equal(r.tier, "T3");
    assert.equal(r.mode, "deliberative");
  });
});
