#!/usr/bin/env node
/**
 * Denial Tracking Tests — PERM-5
 *
 * Run: node --test tests/denial-tracking.test.mjs
 */

import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";

import {
  DenialTracker,
  FALLBACK_THRESHOLD,
  DEACTIVATE_THRESHOLD,
} from "../dist/platform/bus/denial-tracking.js";

// Mock KV store
function createMockKV() {
  const store = new Map();
  return {
    get: (key) => store.get(key) ?? null,
    set: (key, value) => store.set(key, value),
    delete: (key) => store.delete(key),
    _store: store,
  };
}

describe("DenialTracker", () => {
  let tracker;

  beforeEach(() => {
    tracker = new DenialTracker();
  });

  it("initial stats are zero", () => {
    const stats = tracker.getStats("Bash");
    assert.equal(stats.consecutive, 0);
    assert.equal(stats.total, 0);
  });

  it("recordDenial increments both counters", () => {
    tracker.recordDenial("Bash");
    const stats = tracker.getStats("Bash");
    assert.equal(stats.consecutive, 1);
    assert.equal(stats.total, 1);
  });

  it("recordSuccess resets consecutive, preserves total", () => {
    tracker.recordDenial("Bash");
    tracker.recordDenial("Bash");
    tracker.recordSuccess("Bash");
    const stats = tracker.getStats("Bash");
    assert.equal(stats.consecutive, 0);
    assert.equal(stats.total, 2);
  });

  it("3 consecutive → shouldFallback", () => {
    assert.ok(!tracker.shouldFallback("Bash"));
    for (let i = 0; i < FALLBACK_THRESHOLD; i++) {
      tracker.recordDenial("Bash");
    }
    assert.ok(tracker.shouldFallback("Bash"));
  });

  it("success resets fallback condition", () => {
    for (let i = 0; i < FALLBACK_THRESHOLD; i++) {
      tracker.recordDenial("Bash");
    }
    assert.ok(tracker.shouldFallback("Bash"));
    tracker.recordSuccess("Bash");
    assert.ok(!tracker.shouldFallback("Bash"));
  });

  it("20 cumulative → shouldDeactivate", () => {
    assert.ok(!tracker.shouldDeactivate("Bash"));
    for (let i = 0; i < DEACTIVATE_THRESHOLD; i++) {
      tracker.recordDenial("Bash");
      if (i % 5 === 4) tracker.recordSuccess("Bash"); // Intersperse successes
    }
    assert.ok(tracker.shouldDeactivate("Bash"));
  });

  it("tracks tools independently", () => {
    tracker.recordDenial("Bash");
    tracker.recordDenial("Write");
    tracker.recordDenial("Write");
    assert.equal(tracker.getStats("Bash").total, 1);
    assert.equal(tracker.getStats("Write").total, 2);
  });

  it("resetAll clears all stats", () => {
    tracker.recordDenial("Bash");
    tracker.recordDenial("Write");
    tracker.resetAll();
    assert.equal(tracker.getStats("Bash").total, 0);
    assert.equal(tracker.getStats("Write").total, 0);
  });

  it("reset clears specific tool", () => {
    tracker.recordDenial("Bash");
    tracker.recordDenial("Write");
    tracker.reset("Bash");
    assert.equal(tracker.getStats("Bash").total, 0);
    assert.equal(tracker.getStats("Write").total, 1);
  });

  it("recordDenial sets lastDenied timestamp", () => {
    const before = Date.now();
    tracker.recordDenial("Bash");
    const after = Date.now();
    const stats = tracker.getStats("Bash");
    assert.ok(stats.lastDenied >= before && stats.lastDenied <= after);
  });
});

describe("DenialTracker — KV persistence", () => {
  it("persists to KV store", () => {
    const kv = createMockKV();
    const tracker = new DenialTracker(kv);
    tracker.recordDenial("Bash");
    assert.ok(kv._store.has("denial:Bash"));
    const stored = JSON.parse(kv._store.get("denial:Bash"));
    assert.equal(stored.consecutive, 1);
    assert.equal(stored.total, 1);
  });

  it("loads from KV on tool access", () => {
    const kv = createMockKV();
    kv.set("denial:Bash", JSON.stringify({ consecutive: 2, total: 5, lastDenied: 1000 }));

    const tracker = new DenialTracker(kv);
    tracker.loadToolFromKV("Bash");
    const stats = tracker.getStats("Bash");
    assert.equal(stats.consecutive, 2);
    assert.equal(stats.total, 5);
  });

  it("resetAll clears KV entries", () => {
    const kv = createMockKV();
    const tracker = new DenialTracker(kv);
    tracker.recordDenial("Bash");
    tracker.recordDenial("Write");
    tracker.resetAll();
    assert.ok(!kv._store.has("denial:Bash"));
    assert.ok(!kv._store.has("denial:Write"));
  });
});
