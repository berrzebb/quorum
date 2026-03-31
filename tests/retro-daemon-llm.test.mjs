#!/usr/bin/env node
/**
 * RDI-7: Daemon Surfacing + RDI-8: LLM Consolidation Upgrader
 *
 * Run: node --test tests/retro-daemon-llm.test.mjs
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

const { queryGateStatus } = await import("../dist/daemon/state/queries/gates.js");
const {
  upgradeDigest,
  noopUpgrader,
  createMockUpgrader,
} = await import("../platform/core/retro/llm-consolidate.mjs");
const { generateDigest } = await import("../platform/core/retro/digest.mjs");

// ═══ RDI-7: Daemon Gate Surfacing ═════════════════════

describe("RDI-7: Gate status with Dream", () => {
  // Create a minimal mock EventStore
  function createMockStore(retroMarker, dreamState) {
    const kv = new Map();
    if (retroMarker) kv.set("retro:marker", retroMarker);
    if (dreamState) kv.set("dream:state", dreamState);

    return {
      getDb: () => ({
        prepare: () => ({
          get: () => undefined,
        }),
      }),
      getKV: (key) => kv.get(key) ?? null,
      count: () => 0,
    };
  }

  it("shows separate Retro and Dream gates", () => {
    const store = createMockStore(
      { retro_pending: true },
      { consolidationStatus: "running", lastConsolidatedAt: Date.now() - 3600000 },
    );
    const gates = queryGateStatus(store);
    const retroGate = gates.find(g => g.name === "Retro");
    const dreamGate = gates.find(g => g.name === "Dream");

    assert.ok(retroGate, "Retro gate exists");
    assert.equal(retroGate.status, "blocked");

    assert.ok(dreamGate, "Dream gate exists");
    assert.equal(dreamGate.status, "pending"); // running → pending
    assert.ok(dreamGate.detail.includes("running"));
  });

  it("Dream shows idle when no consolidation", () => {
    const store = createMockStore(
      null,
      { consolidationStatus: "idle", lastConsolidatedAt: 1700000000000 },
    );
    const gates = queryGateStatus(store);
    const dreamGate = gates.find(g => g.name === "Dream");
    assert.ok(dreamGate);
    assert.equal(dreamGate.status, "open");
    assert.ok(dreamGate.detail.includes("last consolidated"));
  });

  it("Dream shows error on failed consolidation", () => {
    const store = createMockStore(
      null,
      { consolidationStatus: "failed" },
    );
    const gates = queryGateStatus(store);
    const dreamGate = gates.find(g => g.name === "Dream");
    assert.ok(dreamGate);
    assert.equal(dreamGate.status, "error");
  });

  it("no Dream gate when no dream:state KV", () => {
    const store = createMockStore({ retro_pending: false }, null);
    const gates = queryGateStatus(store);
    const dreamGate = gates.find(g => g.name === "Dream");
    assert.equal(dreamGate, undefined, "Dream gate should not appear without dream:state");
  });

  it("Retro and Dream are independent states", () => {
    // Retro open but Dream running
    const store = createMockStore(
      { retro_pending: false },
      { consolidationStatus: "running" },
    );
    const gates = queryGateStatus(store);
    const retroGate = gates.find(g => g.name === "Retro");
    const dreamGate = gates.find(g => g.name === "Dream");
    assert.equal(retroGate.status, "open");
    assert.equal(dreamGate.status, "pending");
  });
});

// ═══ RDI-8: LLM Upgrader ═════════════════════════════

describe("RDI-8: noopUpgrader", () => {
  it("passes through digest unchanged", async () => {
    const digest = makeTestDigest();
    const result = await upgradeDigest(digest, noopUpgrader);
    assert.equal(result.upgraded, false);
    assert.deepEqual(result.digest, digest);
  });

  it("passes through when no upgrader provided", async () => {
    const digest = makeTestDigest();
    const result = await upgradeDigest(digest, undefined);
    assert.equal(result.upgraded, false);
    assert.deepEqual(result.digest, digest);
  });
});

describe("RDI-8: mock LLM upgrader", () => {
  it("enhances digest content", async () => {
    const digest = makeTestDigest();
    const upgrader = createMockUpgrader();
    const result = await upgradeDigest(digest, upgrader);
    assert.equal(result.upgraded, true);
    assert.ok(result.digest.learnedConstraints[0].includes("LLM enhanced"));
    assert.ok(result.digest.repeatedFailures[0].includes("LLM enhanced"));
  });

  it("falls back to deterministic on failure (core invariant)", async () => {
    const digest = makeTestDigest();
    const upgrader = createMockUpgrader({ shouldFail: true });
    const result = await upgradeDigest(digest, upgrader);
    assert.equal(result.upgraded, false);
    assert.ok(result.error.includes("Mock LLM failure"));
    // Digest unchanged
    assert.deepEqual(result.digest.learnedConstraints, digest.learnedConstraints);
    assert.deepEqual(result.digest.repeatedFailures, digest.repeatedFailures);
  });

  it("non-destructive: keeps original if LLM returns empty arrays", async () => {
    const digest = makeTestDigest();
    const upgrader = {
      name: "empty-upgrader",
      upgrade: async () => ({
        learnedConstraints: [],
        repeatedFailures: [],
        confirmedDecisions: [],
        nextWaveGuidance: [],
        tokenEstimate: 0,
      }),
    };
    const result = await upgradeDigest(digest, upgrader);
    assert.equal(result.upgraded, true);
    // Original values preserved because LLM returned empty
    assert.deepEqual(result.digest.learnedConstraints, digest.learnedConstraints);
  });
});

describe("RDI-8: fallback invariant contract", () => {
  it("LLM path is strict upgrader — never degrades", async () => {
    const digest = makeTestDigest();
    const upgrader = createMockUpgrader();
    const result = await upgradeDigest(digest, upgrader);

    // Enhanced digest should have at least as many items
    assert.ok(result.digest.learnedConstraints.length >= digest.learnedConstraints.length);
    assert.ok(result.digest.repeatedFailures.length >= digest.repeatedFailures.length);
  });

  it("multiple sequential upgrades are idempotent-safe", async () => {
    const digest = makeTestDigest();
    const upgrader = createMockUpgrader();

    const first = await upgradeDigest(digest, upgrader);
    const second = await upgradeDigest(first.digest, upgrader);

    // Both should succeed
    assert.equal(first.upgraded, true);
    assert.equal(second.upgraded, true);
  });
});

// ── Test Helper ──────────────────────────────

function makeTestDigest() {
  return generateDigest({
    trackName: "TEST",
    waveIndex: 3,
    consolidation: {
      learnedConstraints: ["Always validate types"],
      repeatedFailures: ["CQ issues repeat"],
      confirmedDecisions: ["Use SQLite"],
      nextWaveGuidance: ["Fix types first"],
    },
    pruneJournal: {
      decisions: [{ target: "x", decision: "keep", reason: "ok" }],
      totalReviewed: 1, kept: 1, merged: 0, removed: 0, demoted: 0,
    },
    source: "manual",
  });
}
