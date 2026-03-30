#!/usr/bin/env node
/**
 * E2E Smoke Test — full pipeline: event → store → consensus → stagnation → router
 *
 * Simulates a realistic audit cycle:
 * 1. Setup: EventStore + Bus + Router
 * 2. Evidence submission → trigger evaluation → tier routing
 * 3. Deliberative consensus (mock auditors)
 * 4. Verdict events → stagnation detection
 * 5. Failure → escalation → retry → approval
 * 6. Full state recovery from SQLite
 *
 * Run: node --test tests/e2e-smoke.test.mjs
 */

import { strict as assert } from "node:assert";
import { describe, it, before, after } from "node:test";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const { EventStore, UnitOfWork } = await import("../dist/platform/bus/store.js");
const { QuorumBus } = await import("../dist/platform/bus/bus.js");
const { createEvent } = await import("../dist/platform/bus/events.js");
const { detectStagnation } = await import("../dist/platform/bus/stagnation.js");
const { DeliberativeConsensus } = await import("../dist/platform/providers/consensus.js");
const { evaluateTrigger } = await import("../dist/platform/providers/trigger.js");
const { TierRouter } = await import("../dist/platform/providers/router.js");

let tmpDir;

before(() => { tmpDir = mkdtempSync(join(tmpdir(), "e2e-smoke-")); });
after(() => { try { rmSync(tmpDir, { recursive: true, force: true }); } catch (err) { console.warn("e2e-smoke cleanup failed:", err?.message ?? err); } });

function mockAuditor(verdict, summary = "", codes = []) {
  return {
    async audit() {
      return {
        verdict, codes, summary,
        raw: JSON.stringify({ verdict, reasoning: summary, codes, confidence: 0.9 }),
        duration: 10,
      };
    },
    async available() { return true; },
  };
}

// ═══ Full cycle: submit → trigger → route → audit → verdict → stagnation → escalate → approve ═══

describe("E2E: full audit cycle", () => {
  let store, bus, router;

  before(() => {
    store = new EventStore({ dbPath: join(tmpDir, "e2e.db") });
    bus = new QuorumBus({ store, bufferSize: 100 });
    router = new TierRouter();
  });

  after(() => { store.close(); });

  it("step 1: evidence submission triggers audit event", () => {
    bus.emit(createEvent("evidence.write", "claude-code", {
      itemId: "TN-1",
    }));

    const events = store.query({ eventType: "evidence.write" });
    assert.equal(events.length, 1);
    assert.equal(events[0].payload.itemId, "TN-1");
  });

  it("step 2: trigger evaluation determines consensus mode", () => {
    // TN-1: 5 files, security-sensitive → should be T2 or T3
    const result = evaluateTrigger({
      changedFiles: 5,
      securitySensitive: true,
      priorRejections: 0,
      apiSurfaceChanged: false,
      crossLayerChange: false,
      isRevert: false,
    });

    assert.ok(["simple", "deliberative"].includes(result.mode));
    bus.emit(createEvent("audit.submit", "claude-code", {
      itemId: "TN-1",
      tier: result.tier,
      mode: result.mode,
      score: result.score,
    }));

    assert.equal(store.count({ eventType: "audit.submit" }), 1);
  });

  it("step 3: router assigns tier based on complexity", () => {
    const decision = router.route("TN-1", {
      changedFiles: 5,
      toolDependencies: 2,
      nestingDepth: 3,
    });

    bus.emit(createEvent("audit.start", "claude-code", {
      itemId: "TN-1",
      tier: decision.tier,
      complexity: decision.complexity.total,
    }));

    assert.ok(["frugal", "standard", "frontier"].includes(decision.tier));
  });

  it("step 4: first audit REJECTS (lint-gap)", async () => {
    const consensus = new DeliberativeConsensus({
      advocate: mockAuditor("changes_requested", "Lint errors in auth.ts", ["lint-gap"]),
      devil: mockAuditor("changes_requested", "Root cause: missing eslint config", ["lint-gap"]),
      judge: mockAuditor("changes_requested", "Both agree: lint must pass first", ["lint-gap"]),
    });

    const verdict = await consensus.run({
      evidence: "TN-1 evidence",
      prompt: "review",
      files: ["src/auth.ts"],
    });

    assert.equal(verdict.finalVerdict, "changes_requested");
    assert.equal(verdict.mode, "deliberative");

    bus.emit(createEvent("audit.verdict", "codex", {
      itemId: "TN-1",
      verdict: verdict.finalVerdict,
      codes: ["lint-gap"],
      summary: verdict.judgeSummary,
    }));

    // Router records failure
    const escalation = router.recordResult("TN-1", false);
    assert.equal(escalation.escalated, false); // First failure, not yet escalated
  });

  it("step 5: second audit REJECTS again (same codes) → router escalates", async () => {
    const consensus = new DeliberativeConsensus({
      advocate: mockAuditor("changes_requested", "Still lint errors", ["lint-gap"]),
      devil: mockAuditor("changes_requested", "Same issue persists", ["lint-gap"]),
      judge: mockAuditor("changes_requested", "Not fixed", ["lint-gap"]),
    });

    const verdict = await consensus.run({
      evidence: "TN-1 evidence v2",
      prompt: "review",
      files: ["src/auth.ts"],
    });

    bus.emit(createEvent("audit.verdict", "codex", {
      itemId: "TN-1",
      verdict: verdict.finalVerdict,
      codes: ["lint-gap"],
      summary: verdict.judgeSummary,
    }));

    // Router escalates after 2 consecutive failures (base tier is "standard" → escalates to "frontier")
    const escalation = router.recordResult("TN-1", false);
    assert.equal(escalation.escalated, true);
    assert.equal(escalation.tier, "frontier");

    // Third rejection with same codes (needed for spinning detection threshold=3)
    bus.emit(createEvent("audit.verdict", "codex", {
      itemId: "TN-1",
      verdict: "changes_requested",
      codes: ["lint-gap"],
      summary: "Still not fixed after escalation",
    }));
    router.recordResult("TN-1", false);
  });

  it("step 6: stagnation detection identifies spinning pattern", () => {
    const verdictEvents = store.query({ eventType: "audit.verdict" });
    const stagnation = detectStagnation(verdictEvents);

    assert.ok(stagnation.detected);
    assert.ok(stagnation.patterns.some((p) => p.type === "spinning" || p.type === "no-drift"));
    assert.ok(["escalate", "lateral", "halt"].includes(stagnation.recommendation));

    bus.emit(createEvent("quality.fail", "claude-code", {
      pattern: stagnation.patterns[0].type,
      recommendation: stagnation.recommendation,
    }));
  });

  it("step 7: third audit APPROVES after fix", async () => {
    const consensus = new DeliberativeConsensus({
      advocate: mockAuditor("approved", "Lint fixed, tests pass"),
      devil: mockAuditor("approved", "Root cause addressed: eslint config added"),
      judge: mockAuditor("approved", "Both agree: approved"),
    });

    const verdict = await consensus.run({
      evidence: "TN-1 evidence v3 (fixed)",
      prompt: "review",
      files: ["src/auth.ts", ".eslintrc.json"],
    });

    assert.equal(verdict.finalVerdict, "approved");

    bus.emit(createEvent("audit.verdict", "codex", {
      itemId: "TN-1",
      verdict: "approved",
      codes: [],
      summary: verdict.judgeSummary,
    }));

    // Router records success → resets failure counter
    router.recordResult("TN-1", true);
  });

  it("step 8: retro gate activates, then releases", () => {
    bus.emit(createEvent("retro.start", "claude-code", {
      itemId: "TN-1",
      sessionId: "s-123",
    }));

    bus.emit(createEvent("retro.complete", "claude-code", {
      itemId: "TN-1",
      sessionId: "s-123",
      learnings: ["Always configure eslint before implementation"],
    }));

    const retroEvents = store.query({ eventType: "retro.complete" });
    assert.equal(retroEvents.length, 1);
    assert.ok(retroEvents[0].payload.learnings.length > 0);
  });

  it("step 9: merge completes the cycle", () => {
    bus.emit(createEvent("merge.complete", "claude-code", {
      itemId: "TN-1",
      commit: "abc123",
      strategy: "squash",
    }));

    const mergeEvents = store.query({ eventType: "merge.complete" });
    assert.equal(mergeEvents.length, 1);
  });

  it("step 10: full state recoverable from SQLite", () => {
    // Simulate daemon restart — new store + bus from same DB
    const store2 = new EventStore({ dbPath: join(tmpDir, "e2e.db") });
    const bus2 = new QuorumBus({ store: store2, bufferSize: 100 });
    const recovered = bus2.loadFromLog();

    assert.ok(recovered.length >= 8);

    // Verify event sequence
    const types = recovered.map((e) => e.type);
    assert.ok(types.includes("evidence.write"));
    assert.ok(types.includes("audit.submit"));
    assert.ok(types.includes("audit.verdict"));
    assert.ok(types.includes("retro.start"));
    assert.ok(types.includes("retro.complete"));
    assert.ok(types.includes("merge.complete"));

    // Verify stagnation is still detectable from recovered events
    const verdicts = recovered.filter((e) => e.type === "audit.verdict");
    assert.equal(verdicts.length, 4); // 3 rejections + 1 approval

    store2.close();
  });
});

// ═══ UnitOfWork: phase-boundary atomicity ═════════════════════════════

describe("E2E: UnitOfWork phase boundaries", () => {
  it("committed phase survives failed phase", () => {
    const store = new EventStore({ dbPath: join(tmpDir, "uow-e2e.db") });

    // Phase 1: audit submission (committed)
    const base = Date.now();
    const phase1 = new UnitOfWork(store);
    phase1.stage({ type: "audit.submit", source: "claude-code", timestamp: base, payload: { itemId: "TN-2" } });
    phase1.stage({ type: "audit.start", source: "codex", timestamp: base + 1, payload: { itemId: "TN-2" } });
    phase1.commit();

    // Phase 2: verdict processing (fails midway → rollback)
    const phase2 = new UnitOfWork(store);
    phase2.stage(createEvent("audit.verdict", "codex", { itemId: "TN-2", verdict: "approved" }));
    phase2.stage(createEvent("retro.start", "claude-code", { itemId: "TN-2" }));
    // Simulated error → rollback
    phase2.rollback();

    // Only phase 1 events survive
    assert.equal(store.count(), 2);
    const events = store.recent(10);
    assert.equal(events[0].type, "audit.submit");
    assert.equal(events[1].type, "audit.start");

    store.close();
  });
});
