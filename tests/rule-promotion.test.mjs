/**
 * Tests: Rule Registry + Promotion Engine + Push Gate (PROMOTE WB-1,3,5,6)
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { checkPushGate } from "../platform/adapters/shared/push-gate.mjs";

const { RuleRegistry } = await import("../dist/platform/bus/rule-registry.js");
const { checkPromotions, evaluateEffectiveness, demoteRule } = await import("../dist/platform/bus/rule-promotion.js");
const { EventStore } = await import("../dist/platform/bus/store.js");

let store, registry, tmpDir;

beforeEach(() => {
  tmpDir = mkdtempSync(resolve(tmpdir(), "rule-"));
  store = new EventStore({ dbPath: resolve(tmpDir, "test.db") });
  registry = new RuleRegistry(store.db);
});

afterEach(() => {
  store.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

// ── WB-1: Rule Registry ─────────────────────────

describe("RuleRegistry (WB-1)", () => {
  it("adds a rule and returns id", () => {
    const id = registry.addRule({ pattern: "console\\.log", description: "No console.log in prod" });
    assert.ok(id);
    const rule = registry.getRule(id);
    assert.equal(rule.pattern, "console\\.log");
    assert.equal(rule.level, "candidate");
    assert.equal(rule.violationCount, 0);
  });

  it("deduplicates by pattern", () => {
    const id1 = registry.addRule({ pattern: "TODO", description: "No TODOs" });
    const id2 = registry.addRule({ pattern: "TODO", description: "Different desc" });
    assert.equal(id1, id2);
  });

  it("records violations", () => {
    const id = registry.addRule({ pattern: "debugger", description: "No debugger" });
    registry.recordViolation(id);
    registry.recordViolation(id);
    registry.recordViolation(id);
    const rule = registry.getRule(id);
    assert.equal(rule.violationCount, 3);
    assert.ok(rule.lastViolated);
  });

  it("filters by level", () => {
    const id = registry.addRule({ pattern: "test", description: "test" });
    registry.promoteRule(id, "soft");
    assert.equal(registry.getRules({ level: "soft" }).length, 1);
    assert.equal(registry.getRules({ level: "candidate" }).length, 0);
  });

  it("filters by minViolations", () => {
    const id = registry.addRule({ pattern: "p1", description: "d1" });
    registry.recordViolation(id);
    registry.recordViolation(id);
    registry.addRule({ pattern: "p2", description: "d2" });
    assert.equal(registry.getRules({ minViolations: 2 }).length, 1);
  });
});

// ── WB-3: Promotion Engine ──────────────────────

describe("checkPromotions (WB-3)", () => {
  it("promotes candidate → SOFT at 3 violations", () => {
    const id = registry.addRule({ pattern: "console\\.log", description: "No console.log" });
    for (let i = 0; i < 3; i++) registry.recordViolation(id);
    const results = checkPromotions(registry);
    assert.equal(results.length, 1);
    assert.equal(results[0].from, "candidate");
    assert.equal(results[0].to, "soft");
    assert.equal(registry.getRule(id).level, "soft");
  });

  it("promotes SOFT → HARD at 5 violations", () => {
    const id = registry.addRule({ pattern: "eval", description: "No eval" });
    for (let i = 0; i < 3; i++) registry.recordViolation(id);
    checkPromotions(registry); // candidate → soft
    registry.recordViolation(id);
    registry.recordViolation(id); // now 5
    const results = checkPromotions(registry);
    assert.equal(results.length, 1);
    assert.equal(results[0].to, "hard");
  });

  it("does not promote below threshold", () => {
    registry.addRule({ pattern: "test", description: "test" });
    registry.recordViolation(registry.getRules()[0].id);
    assert.equal(checkPromotions(registry).length, 0);
  });

  it("respects custom thresholds", () => {
    const id = registry.addRule({ pattern: "p", description: "d" });
    registry.recordViolation(id);
    registry.recordViolation(id);
    const results = checkPromotions(registry, { softThreshold: 2 });
    assert.equal(results.length, 1);
    assert.equal(results[0].to, "soft");
  });
});

// ── WB-5: Meta Loop ─────────────────────────────

describe("evaluateEffectiveness (WB-5)", () => {
  it("verifies effective rule (no violations since promotion)", () => {
    const id = registry.addRule({ pattern: "p", description: "d" });
    for (let i = 0; i < 3; i++) registry.recordViolation(id);
    checkPromotions(registry);
    // Backdate promotion AND last_violated to 31 days ago (violations were pre-promotion)
    const thirtyOneDaysAgo = Date.now() - 31 * 86400_000;
    store.db.prepare("UPDATE rules SET promoted_at = ?, last_violated = ? WHERE id = ?")
      .run(thirtyOneDaysAgo, thirtyOneDaysAgo - 1000, id); // last_violated < promoted_at
    const results = evaluateEffectiveness(registry);
    assert.equal(results.length, 1);
    assert.equal(results[0].action, "verified");
  });

  it("archives never-triggered rule", () => {
    const id = registry.addRule({ pattern: "p", description: "d" });
    registry.promoteRule(id, "soft");
    store.db.prepare("UPDATE rules SET promoted_at = ?, violation_count = 0 WHERE id = ?")
      .run(Date.now() - 31 * 86400_000, id);
    const results = evaluateEffectiveness(registry);
    assert.equal(results[0].action, "archived");
  });

  it("skips rules not yet 30 days old", () => {
    const id = registry.addRule({ pattern: "p", description: "d" });
    registry.promoteRule(id, "soft");
    // promoted_at = now → not yet 30 days
    const results = evaluateEffectiveness(registry);
    assert.equal(results.length, 0);
  });
});

describe("demoteRule", () => {
  it("demotes to candidate", () => {
    const id = registry.addRule({ pattern: "p", description: "d" });
    registry.promoteRule(id, "hard");
    demoteRule(registry, id, "candidate");
    assert.equal(registry.getRule(id).level, "candidate");
  });
});

// ── WB-6: Push Gate ─────────────────────────────

describe("checkPushGate (WB-6)", () => {
  it("strict + low fitness → blocked", () => {
    const r = checkPushGate({ gateProfile: "strict", fitnessScore: 0.3, hardViolations: [] });
    assert.equal(r.allowed, false);
    assert.ok(r.blockReason);
  });

  it("strict + good fitness → allowed", () => {
    const r = checkPushGate({ gateProfile: "strict", fitnessScore: 0.8, hardViolations: [] });
    assert.equal(r.allowed, true);
  });

  it("balanced + low fitness → warning only", () => {
    const r = checkPushGate({ gateProfile: "balanced", fitnessScore: 0.3, hardViolations: [] });
    assert.equal(r.allowed, true);
    assert.ok(r.warnings.length > 0);
  });

  it("fast → always allowed", () => {
    const r = checkPushGate({ gateProfile: "fast", fitnessScore: 0.1, hardViolations: [{ id: "x", pattern: "p" }] });
    assert.equal(r.allowed, true);
    assert.equal(r.warnings.length, 0);
  });

  it("strict + HARD violations → blocked", () => {
    const r = checkPushGate({ gateProfile: "strict", fitnessScore: 0.9, hardViolations: [{ id: "x", pattern: "eval" }] });
    assert.equal(r.allowed, false);
  });

  it("no issues → allowed", () => {
    const r = checkPushGate({ gateProfile: "strict", fitnessScore: 0.9, hardViolations: [] });
    assert.equal(r.allowed, true);
  });
});
