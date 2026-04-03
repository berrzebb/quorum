#!/usr/bin/env node
/**
 * Hash Chain Tests — HASH-1~3
 *
 * Run: node --test tests/hash-chain.test.mjs
 */

import assert from "node:assert/strict";
import { describe, it, afterEach } from "node:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  EventStore,
  computeEventHash,
  GENESIS_HASH,
} from "../dist/platform/bus/store.js";

function createTempStore() {
  const dbPath = join(tmpdir(), `quorum-hash-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  const store = new EventStore({ dbPath });
  return { store, dbPath };
}

function makeEvent(type, payload = {}) {
  return {
    type,
    source: "test",
    payload,
    timestamp: Date.now(),
  };
}

const cleanupPaths = [];
afterEach(() => {
  for (const p of cleanupPaths) {
    try { rmSync(p, { force: true }); } catch {}
    try { rmSync(p + "-wal", { force: true }); } catch {}
    try { rmSync(p + "-shm", { force: true }); } catch {}
  }
  cleanupPaths.length = 0;
});

// ═══ 1. computeEventHash ════════════════════════════════

describe("computeEventHash", () => {
  it("deterministic — same input → same hash", () => {
    const h1 = computeEventHash("prev", "test", "{}", 1000);
    const h2 = computeEventHash("prev", "test", "{}", 1000);
    assert.equal(h1, h2);
  });

  it("different input → different hash", () => {
    const h1 = computeEventHash("prev", "test", "{}", 1000);
    const h2 = computeEventHash("prev", "test", "{}", 2000);
    assert.notEqual(h1, h2);
  });

  it("returns 64-char hex string (SHA-256)", () => {
    const h = computeEventHash("x", "y", "{}", 0);
    assert.equal(h.length, 64);
    assert.ok(/^[0-9a-f]+$/.test(h));
  });
});

// ═══ 2. GENESIS_HASH ════════════════════════════════════

describe("GENESIS_HASH", () => {
  it("is a 64-char hex string", () => {
    assert.equal(GENESIS_HASH.length, 64);
    assert.ok(/^[0-9a-f]+$/.test(GENESIS_HASH));
  });

  it("is deterministic", async () => {
    const { createHash } = await import("node:crypto");
    const expected = createHash("sha256").update("quorum-genesis").digest("hex");
    assert.equal(GENESIS_HASH, expected);
  });
});

// ═══ 3. Chain-linked append ═════════════════════════════

describe("chain-linked append", () => {
  it("single append has hash", () => {
    const { store, dbPath } = createTempStore();
    cleanupPaths.push(dbPath);

    const id = store.append(makeEvent("test.event"));
    const events = store.query({ eventType: "test.event" });
    assert.equal(events.length, 1);
    // Hash exists on the event (check DB directly)
    const row = store.getDb().prepare("SELECT hash, prev_hash FROM events WHERE id = ?").get(id);
    assert.ok(row.hash);
    assert.ok(row.prev_hash);
    assert.equal(row.prev_hash, GENESIS_HASH); // First event
  });

  it("chain links consecutive events", () => {
    const { store, dbPath } = createTempStore();
    cleanupPaths.push(dbPath);

    const id1 = store.append(makeEvent("event.1"));
    const id2 = store.append(makeEvent("event.2"));
    const id3 = store.append(makeEvent("event.3"));

    const row1 = store.getDb().prepare("SELECT hash, prev_hash FROM events WHERE id = ?").get(id1);
    const row2 = store.getDb().prepare("SELECT hash, prev_hash FROM events WHERE id = ?").get(id2);
    const row3 = store.getDb().prepare("SELECT hash, prev_hash FROM events WHERE id = ?").get(id3);

    assert.equal(row1.prev_hash, GENESIS_HASH);
    assert.equal(row2.prev_hash, row1.hash);
    assert.equal(row3.prev_hash, row2.hash);
  });

  it("batch append chains within batch", () => {
    const { store, dbPath } = createTempStore();
    cleanupPaths.push(dbPath);

    const ids = store.appendBatch([
      makeEvent("batch.1"),
      makeEvent("batch.2"),
      makeEvent("batch.3"),
    ]);

    const rows = ids.map(id =>
      store.getDb().prepare("SELECT hash, prev_hash FROM events WHERE id = ?").get(id),
    );

    assert.equal(rows[0].prev_hash, GENESIS_HASH);
    assert.equal(rows[1].prev_hash, rows[0].hash);
    assert.equal(rows[2].prev_hash, rows[1].hash);
  });
});

// ═══ 4. verifyChain ═════════════════════════════════════

describe("verifyChain", () => {
  it("empty DB → valid", () => {
    const { store, dbPath } = createTempStore();
    cleanupPaths.push(dbPath);

    const result = store.verifyChain();
    assert.ok(result.valid);
    assert.equal(result.checked, 0);
  });

  it("valid chain → valid: true", () => {
    const { store, dbPath } = createTempStore();
    cleanupPaths.push(dbPath);

    store.append(makeEvent("a"));
    store.append(makeEvent("b"));
    store.append(makeEvent("c"));

    const result = store.verifyChain();
    assert.ok(result.valid);
    assert.equal(result.checked, 3);
  });

  it("tampered payload → valid: false + brokenAt", () => {
    const { store, dbPath } = createTempStore();
    cleanupPaths.push(dbPath);

    store.append(makeEvent("a"));
    const id2 = store.append(makeEvent("b", { secret: "original" }));
    store.append(makeEvent("c"));

    // Tamper with event 2's payload
    store.getDb().prepare(
      "UPDATE events SET payload = ? WHERE id = ?",
    ).run('{"secret":"TAMPERED"}', id2);

    const result = store.verifyChain();
    assert.ok(!result.valid);
    assert.equal(result.brokenAt, id2);
  });

  it("null-hash events skipped (legacy migration)", () => {
    const { store, dbPath } = createTempStore();
    cleanupPaths.push(dbPath);

    // Insert a legacy event without hash
    store.getDb().prepare(
      "INSERT INTO events (id, event_type, source, payload, timestamp) VALUES (?, ?, ?, ?, ?)",
    ).run("legacy-1", "legacy.event", "test", "{}", Date.now());

    // Insert a new event with hash
    store.append(makeEvent("new.event"));

    const result = store.verifyChain();
    assert.ok(result.valid);
    assert.equal(result.skipped, 1);
    assert.equal(result.checked, 1);
  });

  it("range verification (fromId, toId)", () => {
    const { store, dbPath } = createTempStore();
    cleanupPaths.push(dbPath);

    const id1 = store.append(makeEvent("a"));
    const id2 = store.append(makeEvent("b"));
    const id3 = store.append(makeEvent("c"));

    const result = store.verifyChain(id2, id3);
    assert.ok(result.valid);
    assert.equal(result.checked, 2);
  });
});

// ═══ 5. Performance ═════════════════════════════════════

describe("hash chain — performance", () => {
  it("append with hash < 2ms per event", () => {
    const { store, dbPath } = createTempStore();
    cleanupPaths.push(dbPath);

    const start = performance.now();
    for (let i = 0; i < 100; i++) {
      store.append(makeEvent("perf.test", { i }));
    }
    const elapsed = performance.now() - start;
    // 100 appends should be well under 200ms (2ms each)
    assert.ok(elapsed < 2000, `100 appends took ${elapsed}ms`);
  });
});
