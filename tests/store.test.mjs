#!/usr/bin/env node
/**
 * EventStore Tests — SQLite persistence, queries, UnitOfWork, bus integration.
 *
 * Run: node --test tests/store.test.mjs
 */

import { strict as assert } from "node:assert";
import { describe, it, before, after } from "node:test";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const { EventStore, UnitOfWork } = await import("../dist/platform/bus/store.js");
const { QuorumBus } = await import("../dist/platform/bus/bus.js");
const { createEvent } = await import("../dist/platform/bus/events.js");

let tmpDir;

before(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "store-test-"));
});

after(() => {
  // Allow SQLite WAL files to be released
  try {
    if (tmpDir && existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  } catch { /* Windows may hold file locks briefly */ }
});

// ═══ 1. EventStore basics ═════════════════════════════════════════════

describe("EventStore append + query", () => {
  it("creates database and schema", () => {
    const dbPath = join(tmpDir, "basic.db");
    const store = new EventStore({ dbPath });
    assert.ok(existsSync(dbPath));
    store.close();
  });

  it("appends and retrieves events", () => {
    const store = new EventStore({ dbPath: join(tmpDir, "append.db") });

    const event = createEvent("audit.start", "claude-code", { file: "test.ts" });
    const id = store.append(event);
    assert.ok(id);

    const events = store.recent(10);
    assert.equal(events.length, 1);
    assert.equal(events[0].type, "audit.start");
    assert.equal(events[0].source, "claude-code");
    assert.equal(events[0].payload.file, "test.ts");

    store.close();
  });

  it("appendBatch inserts atomically", () => {
    const store = new EventStore({ dbPath: join(tmpDir, "batch.db") });

    const events = [
      createEvent("audit.start", "codex"),
      createEvent("audit.verdict", "codex", { verdict: "approved" }),
      createEvent("retro.complete", "claude-code"),
    ];

    const ids = store.appendBatch(events);
    assert.equal(ids.length, 3);
    assert.equal(store.count(), 3);

    store.close();
  });

  it("recent() returns events in chronological order", () => {
    const store = new EventStore({ dbPath: join(tmpDir, "order.db") });

    const base = Date.now();
    store.append({ type: "agent.spawn", source: "claude-code", timestamp: base, payload: { name: "first" } });
    store.append({ type: "agent.spawn", source: "claude-code", timestamp: base + 1, payload: { name: "second" } });
    store.append({ type: "agent.spawn", source: "claude-code", timestamp: base + 2, payload: { name: "third" } });

    const events = store.recent(10);
    assert.equal(events.length, 3);
    assert.equal(events[0].payload.name, "first");
    assert.equal(events[2].payload.name, "third");

    store.close();
  });
});

// ═══ 2. Query filtering ═══════════════════════════════════════════════

describe("EventStore query", () => {
  let store;

  before(() => {
    store = new EventStore({ dbPath: join(tmpDir, "query.db") });
    store.append(createEvent("audit.start", "claude-code", {}, { sessionId: "s1" }));
    store.append(createEvent("audit.verdict", "codex", { verdict: "approved" }, { sessionId: "s1" }));
    store.append(createEvent("quality.fail", "claude-code", { file: "a.ts" }, { sessionId: "s1" }));
    store.append(createEvent("audit.start", "cursor", {}, { sessionId: "s2" }));
    store.append(createEvent("retro.complete", "claude-code", {}, { sessionId: "s2" }));
  });

  after(() => store.close());

  it("filters by eventType", () => {
    const results = store.query({ eventType: "audit.start" });
    assert.equal(results.length, 2);
  });

  it("filters by source", () => {
    const results = store.query({ source: "claude-code" });
    assert.equal(results.length, 3);
  });

  it("filters by source + eventType", () => {
    const results = store.query({ source: "claude-code", eventType: "audit.start" });
    assert.equal(results.length, 1);
  });

  it("supports limit", () => {
    const results = store.query({ limit: 2 });
    assert.equal(results.length, 2);
  });

  it("count() returns total matching events", () => {
    assert.equal(store.count(), 5);
    assert.equal(store.count({ eventType: "audit.start" }), 2);
    assert.equal(store.count({ source: "codex" }), 1);
  });
});

// ═══ 3. Cursor-based pagination (getEventsAfter) ══════════════════════

describe("EventStore cursor pagination", () => {
  it("returns events after timestamp", () => {
    const store = new EventStore({ dbPath: join(tmpDir, "cursor.db") });

    const t1 = Date.now() - 3000;
    const t2 = Date.now() - 2000;
    const t3 = Date.now() - 1000;

    store.append({ type: "audit.start", source: "codex", timestamp: t1, payload: { n: 1 } });
    store.append({ type: "audit.verdict", source: "codex", timestamp: t2, payload: { n: 2 } });
    store.append({ type: "retro.complete", source: "claude-code", timestamp: t3, payload: { n: 3 } });

    const after = store.getEventsAfter(t1);
    assert.equal(after.length, 2);
    assert.equal(after[0].payload.n, 2);
    assert.equal(after[1].payload.n, 3);

    store.close();
  });
});

// ═══ 4. Aggregate replay ══════════════════════════════════════════════

describe("EventStore replay", () => {
  it("replays events for a specific aggregate", () => {
    const store = new EventStore({ dbPath: join(tmpDir, "replay.db") });

    const base = Date.now();
    store.append({ type: "track.create", source: "claude-code", timestamp: base, payload: { aggregateType: "track", aggregateId: "TN-1", total: 5 } });
    store.append({ type: "track.progress", source: "claude-code", timestamp: base + 1, payload: { aggregateType: "track", aggregateId: "TN-1", completed: 2 } });
    store.append({ type: "track.create", source: "claude-code", timestamp: base + 2, payload: { aggregateType: "track", aggregateId: "TN-2", total: 3 } });
    store.append({ type: "track.progress", source: "claude-code", timestamp: base + 3, payload: { aggregateType: "track", aggregateId: "TN-1", completed: 5 } });

    const tn1Events = store.replay("track", "TN-1");
    assert.equal(tn1Events.length, 3);
    assert.equal(tn1Events[0].payload.total, 5);
    assert.equal(tn1Events[2].payload.completed, 5);

    const tn2Events = store.replay("track", "TN-2");
    assert.equal(tn2Events.length, 1);

    store.close();
  });
});

// ═══ 5. UnitOfWork ════════════════════════════════════════════════════

describe("UnitOfWork", () => {
  it("stages events without persisting", () => {
    const store = new EventStore({ dbPath: join(tmpDir, "uow.db") });
    const uow = new UnitOfWork(store);

    uow.stage(createEvent("audit.start", "codex"));
    uow.stage(createEvent("audit.verdict", "codex", { verdict: "approved" }));

    assert.equal(uow.size, 2);
    assert.equal(store.count(), 0);

    store.close();
  });

  it("commit() persists all staged events atomically", () => {
    const store = new EventStore({ dbPath: join(tmpDir, "uow-commit.db") });
    const uow = new UnitOfWork(store);

    uow.stage(createEvent("audit.start", "codex"));
    uow.stage(createEvent("audit.verdict", "codex", { verdict: "approved" }));

    const ids = uow.commit();
    assert.equal(ids.length, 2);
    assert.equal(uow.size, 0);
    assert.equal(store.count(), 2);

    store.close();
  });

  it("rollback() discards staged events", () => {
    const store = new EventStore({ dbPath: join(tmpDir, "uow-rollback.db") });
    const uow = new UnitOfWork(store);

    uow.stage(createEvent("audit.start", "codex"));
    uow.stage(createEvent("quality.fail", "codex", { file: "bad.ts" }));

    uow.rollback();
    assert.equal(uow.size, 0);
    assert.equal(store.count(), 0);

    store.close();
  });

  it("committed events survive rollback of later phase", () => {
    const store = new EventStore({ dbPath: join(tmpDir, "uow-phases.db") });

    // Phase 1: commit
    const uow1 = new UnitOfWork(store);
    uow1.stage(createEvent("audit.start", "codex"));
    uow1.commit();

    // Phase 2: rollback
    const uow2 = new UnitOfWork(store);
    uow2.stage(createEvent("quality.fail", "codex", { file: "bad.ts" }));
    uow2.rollback();

    // Phase 1 events survive
    assert.equal(store.count(), 1);
    const events = store.recent(10);
    assert.equal(events[0].type, "audit.start");

    store.close();
  });
});

// ═══ 6. Bus + SQLite integration ══════════════════════════════════════

describe("QuorumBus with SQLite store", () => {
  it("persists events via store instead of JSONL", () => {
    const store = new EventStore({ dbPath: join(tmpDir, "bus-sqlite.db") });
    const bus = new QuorumBus({ store });

    bus.emit(createEvent("session.start", "claude-code", { mode: "test" }));
    bus.emit(createEvent("audit.start", "codex"));

    assert.equal(store.count(), 2);
    assert.equal(bus.recent().length, 2);

    store.close();
  });

  it("loadFromLog() recovers from SQLite store", () => {
    const dbPath = join(tmpDir, "bus-recover.db");
    const store1 = new EventStore({ dbPath });
    const bus1 = new QuorumBus({ store: store1 });

    const base = Date.now();
    bus1.emit({ type: "audit.start", source: "claude-code", timestamp: base, payload: {} });
    bus1.emit({ type: "audit.verdict", source: "codex", timestamp: base + 1, payload: { verdict: "approved" } });
    store1.close();

    // New bus + store — simulates daemon restart
    const store2 = new EventStore({ dbPath });
    const bus2 = new QuorumBus({ store: store2 });
    const events = bus2.loadFromLog();

    assert.equal(events.length, 2);
    assert.equal(bus2.recent().length, 2);
    assert.equal(bus2.recent()[1].payload.verdict, "approved");

    store2.close();
  });

  it("pub/sub still works with SQLite backend", () => {
    const store = new EventStore({ dbPath: join(tmpDir, "bus-pubsub.db") });
    const bus = new QuorumBus({ store });
    const received = [];
    bus.on("audit.verdict", (e) => received.push(e));

    bus.emit(createEvent("audit.verdict", "codex", { verdict: "approved" }));

    assert.equal(received.length, 1);
    assert.equal(received[0].payload.verdict, "approved");

    store.close();
  });
});
