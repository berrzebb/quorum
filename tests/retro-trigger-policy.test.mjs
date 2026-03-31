#!/usr/bin/env node
/**
 * RDI-1: Retro State Split + 3-Gate Trigger Policy
 *
 * Run: node --test tests/retro-trigger-policy.test.mjs
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

const {
  createRetroState,
  evaluateTrigger,
  evaluateWaveEndTrigger,
  transitionConsolidation,
  incrementSessions,
  buildRetroState,
  DEFAULT_TRIGGER_THRESHOLDS,
} = await import("../platform/core/retro/trigger-policy.mjs");

// ═══ State Model ═══════════════════════════════════════

describe("RDI-1: RetroState model", () => {
  it("creates default state with retro open and consolidation idle", () => {
    const state = createRetroState();
    assert.equal(state.retroPending, false);
    assert.equal(state.consolidationStatus, "idle");
    assert.equal(state.lastConsolidatedAt, null);
    assert.equal(state.lastDigestId, null);
    assert.equal(state.sessionsSinceLastConsolidation, 0);
  });

  it("retroPending and consolidationStatus are independent", () => {
    let state = createRetroState();
    state.retroPending = true;
    state = transitionConsolidation(state, "running");
    assert.equal(state.retroPending, true, "retro still pending while consolidation runs");
    assert.equal(state.consolidationStatus, "running");
  });

  it("consolidation success does NOT clear retroPending (core invariant)", () => {
    let state = createRetroState();
    state.retroPending = true;
    state = transitionConsolidation(state, "running");
    state = transitionConsolidation(state, "ready", {
      lastConsolidatedAt: Date.now(),
      lastDigestId: "digest-001",
    });
    assert.equal(state.retroPending, true, "INVARIANT: Dream success never clears retroPending");
    assert.equal(state.consolidationStatus, "ready");
    assert.equal(state.lastDigestId, "digest-001");
  });
});

// ═══ State Transitions ═════════════════════════════════

describe("RDI-1: State transitions", () => {
  it("idle → pending → running → ready", () => {
    let state = createRetroState();
    state = transitionConsolidation(state, "pending");
    assert.equal(state.consolidationStatus, "pending");

    state = transitionConsolidation(state, "running");
    assert.equal(state.consolidationStatus, "running");

    const now = Date.now();
    state = transitionConsolidation(state, "ready", { lastConsolidatedAt: now, lastDigestId: "d1" });
    assert.equal(state.consolidationStatus, "ready");
    assert.equal(state.lastConsolidatedAt, now);
    assert.equal(state.lastDigestId, "d1");
  });

  it("running → failed → idle", () => {
    let state = createRetroState();
    state = transitionConsolidation(state, "running");
    state = transitionConsolidation(state, "failed");
    assert.equal(state.consolidationStatus, "failed");

    state = transitionConsolidation(state, "idle");
    assert.equal(state.consolidationStatus, "idle");
  });

  it("ready resets session counter", () => {
    let state = createRetroState();
    state = incrementSessions(state);
    state = incrementSessions(state);
    state = incrementSessions(state);
    assert.equal(state.sessionsSinceLastConsolidation, 3);

    state = transitionConsolidation(state, "ready", { lastConsolidatedAt: Date.now() });
    assert.equal(state.sessionsSinceLastConsolidation, 0, "sessions reset on ready");
  });

  it("incrementSessions tracks count", () => {
    let state = createRetroState();
    for (let i = 0; i < 7; i++) state = incrementSessions(state);
    assert.equal(state.sessionsSinceLastConsolidation, 7);
  });
});

// ═══ 3-Gate Trigger Evaluation ═════════════════════════

describe("RDI-1: evaluateTrigger", () => {
  const HOUR_MS = 60 * 60 * 1000;
  const NOW = Date.now();

  it("returns ineligible when all gates fail", () => {
    const state = createRetroState();
    state.lastConsolidatedAt = NOW; // just consolidated
    state.sessionsSinceLastConsolidation = 1; // not enough
    const snap = evaluateTrigger(state, false, undefined, NOW);
    assert.equal(snap.eligible, false);
    assert.deepEqual(snap.gates, [false, false, false]);
    assert.ok(snap.reason.includes("time"));
    assert.ok(snap.reason.includes("sessions"));
    assert.ok(snap.reason.includes("lock"));
  });

  it("returns eligible when all 3 gates pass", () => {
    const state = createRetroState();
    state.lastConsolidatedAt = NOW - 25 * HOUR_MS; // 25h ago
    state.sessionsSinceLastConsolidation = 6;
    const snap = evaluateTrigger(state, true, undefined, NOW);
    assert.equal(snap.eligible, true);
    assert.deepEqual(snap.gates, [true, true, true]);
    assert.ok(snap.reason.includes("all gates pass"));
  });

  it("time gate: fails when under threshold", () => {
    const state = createRetroState();
    state.lastConsolidatedAt = NOW - 10 * HOUR_MS; // 10h < 24h
    state.sessionsSinceLastConsolidation = 10;
    const snap = evaluateTrigger(state, true, undefined, NOW);
    assert.equal(snap.eligible, false);
    assert.equal(snap.gates[0], false);
    assert.equal(snap.gates[1], true);
  });

  it("sessions gate: fails when under threshold", () => {
    const state = createRetroState();
    state.lastConsolidatedAt = NOW - 30 * HOUR_MS;
    state.sessionsSinceLastConsolidation = 3; // < 5
    const snap = evaluateTrigger(state, true, undefined, NOW);
    assert.equal(snap.eligible, false);
    assert.equal(snap.gates[0], true);
    assert.equal(snap.gates[1], false);
  });

  it("lock gate: fails when unavailable", () => {
    const state = createRetroState();
    state.lastConsolidatedAt = NOW - 30 * HOUR_MS;
    state.sessionsSinceLastConsolidation = 10;
    const snap = evaluateTrigger(state, false, undefined, NOW);
    assert.equal(snap.eligible, false);
    assert.equal(snap.gates[2], false);
  });

  it("never-consolidated state: time gate passes (Infinity hours)", () => {
    const state = createRetroState();
    state.sessionsSinceLastConsolidation = 5;
    const snap = evaluateTrigger(state, true, undefined, NOW);
    assert.equal(snap.eligible, true);
    assert.equal(snap.hoursSince, Infinity);
  });

  it("custom thresholds override defaults", () => {
    const state = createRetroState();
    state.lastConsolidatedAt = NOW - 2 * HOUR_MS;
    state.sessionsSinceLastConsolidation = 2;
    const snap = evaluateTrigger(state, true, { minHours: 1, minSessions: 2 }, NOW);
    assert.equal(snap.eligible, true);
  });
});

// ═══ Wave-End Micro Trigger ════════════════════════════

describe("RDI-1: evaluateWaveEndTrigger", () => {
  it("eligible when lock available", () => {
    const snap = evaluateWaveEndTrigger(true, true);
    assert.equal(snap.eligible, true);
    assert.ok(snap.reason.includes("wave-end trigger"));
  });

  it("blocked when lock unavailable", () => {
    const snap = evaluateWaveEndTrigger(false, false);
    assert.equal(snap.eligible, false);
    assert.ok(snap.reason.includes("lock unavailable"));
  });

  it("time and session gates always pass for wave-end", () => {
    const snap = evaluateWaveEndTrigger(true, false);
    assert.deepEqual(snap.gates, [true, true, true]);
  });
});

// ═══ buildRetroState ═══════════════════════════════════

describe("RDI-1: buildRetroState", () => {
  it("builds from marker + kv data", () => {
    const state = buildRetroState(
      { retro_pending: true },
      { consolidationStatus: "running", lastConsolidatedAt: 1000, sessionsSinceLastConsolidation: 3 },
    );
    assert.equal(state.retroPending, true);
    assert.equal(state.consolidationStatus, "running");
    assert.equal(state.lastConsolidatedAt, 1000);
    assert.equal(state.sessionsSinceLastConsolidation, 3);
  });

  it("handles null marker and kv data", () => {
    const state = buildRetroState(null, null);
    assert.equal(state.retroPending, false);
    assert.equal(state.consolidationStatus, "idle");
  });

  it("handles partial kv data", () => {
    const state = buildRetroState(null, { lastConsolidatedAt: 5000 });
    assert.equal(state.consolidationStatus, "idle");
    assert.equal(state.lastConsolidatedAt, 5000);
  });
});
