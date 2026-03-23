#!/usr/bin/env node
/**
 * LockService + TransactionalUnitOfWork + KV State + State Transitions Tests
 *
 * Run: node --test tests/lock.test.mjs
 */

import { strict as assert } from "node:assert";
import { describe, it, beforeEach } from "node:test";
import { resolve } from "node:path";
import { existsSync, readFileSync } from "node:fs";

import { createTempStore, cleanup } from "./helpers.mjs";

const { EventStore, TransactionalUnitOfWork } = await import("../dist/bus/store.js");
const { LockService } = await import("../dist/bus/lock.js");
const { createEvent } = await import("../dist/bus/events.js");

// ═══ 1. LockService ═══════════════════════════════════════════════════

describe("LockService", () => {
  let store, dir, lockService;

  beforeEach(() => {
    ({ store, dir } = createTempStore());
    lockService = new LockService(store.getDb());
  });

  it("acquires a lock", () => {
    const result = lockService.acquire("audit:main", 1234);
    assert.equal(result, true);
  });

  it("blocks second acquire from different PID", () => {
    lockService.acquire("audit:main", 1234);
    const result = lockService.acquire("audit:main", 5678);
    assert.equal(result, false);
  });

  it("allows same PID to re-acquire (idempotent refresh)", () => {
    lockService.acquire("audit:main", 1234);
    const result = lockService.acquire("audit:main", 1234);
    assert.equal(result, true);
  });

  it("releases a lock", () => {
    lockService.acquire("audit:main", 1234);
    const released = lockService.release("audit:main", 1234);
    assert.equal(released, true);

    // Now another PID can acquire
    const result = lockService.acquire("audit:main", 5678);
    assert.equal(result, true);
  });

  it("only owner can release", () => {
    lockService.acquire("audit:main", 1234);
    const released = lockService.release("audit:main", 9999);
    assert.equal(released, false);

    // Lock still held
    const info = lockService.isHeld("audit:main");
    assert.equal(info.held, true);
    assert.equal(info.owner, 1234);
  });

  it("isHeld returns correct info", () => {
    assert.equal(lockService.isHeld("audit:main").held, false);

    lockService.acquire("audit:main", 1234, "session-abc");
    const info = lockService.isHeld("audit:main");
    assert.equal(info.held, true);
    assert.equal(info.owner, 1234);
    assert.equal(info.ownerSession, "session-abc");
    assert.ok(info.acquiredAt > 0);
  });

  it("cleans expired locks", () => {
    // Acquire normally, then backdate the lock to make it expired
    lockService.acquire("audit:main", 1234, undefined, 1000);
    // Manually set acquired_at to far in the past
    store.getDb().prepare(
      `UPDATE locks SET acquired_at = 0, ttl_ms = 1 WHERE lock_name = ?`
    ).run("audit:main");

    const cleaned = lockService.cleanExpired();
    assert.equal(cleaned, 1);

    // Lock is gone
    assert.equal(lockService.isHeld("audit:main").held, false);
  });

  it("expired lock allows new acquire", () => {
    lockService.acquire("audit:main", 1234, undefined, 1000);
    // Backdate to make it expired
    store.getDb().prepare(
      `UPDATE locks SET acquired_at = 0, ttl_ms = 1 WHERE lock_name = ?`
    ).run("audit:main");

    // New PID can acquire
    const result = lockService.acquire("audit:main", 5678);
    assert.equal(result, true);
  });

  it("multiple independent locks", () => {
    lockService.acquire("audit:main", 1111);
    lockService.acquire("audit:worktree-1", 2222);
    lockService.acquire("audit:worktree-2", 3333);

    const active = lockService.listActive();
    assert.equal(active.length, 3);
  });

  it("listActive excludes expired", () => {
    lockService.acquire("alive", 1111, undefined, 3600000);
    lockService.acquire("dead", 2222, undefined, 1000);
    // Backdate "dead" to make it expired
    store.getDb().prepare(
      `UPDATE locks SET acquired_at = 0, ttl_ms = 1 WHERE lock_name = ?`
    ).run("dead");

    const active = lockService.listActive();
    assert.equal(active.length, 1);
    assert.equal(active[0].lockName, "alive");
  });

  // Cleanup
  it("cleanup", () => {
    store.close();
    cleanup(dir);
  });
});

// ═══ 2. KV State ══════════════════════════════════════════════════════

describe("KV State", () => {
  let store, dir;

  beforeEach(() => {
    ({ store, dir } = createTempStore());
  });

  it("setKV and getKV roundtrip", () => {
    store.setKV("retro:marker", { retro_pending: true, session_id: "abc" });
    const result = store.getKV("retro:marker");
    assert.deepEqual(result, { retro_pending: true, session_id: "abc" });
  });

  it("getKV returns null for missing key", () => {
    assert.equal(store.getKV("nonexistent"), null);
  });

  it("setKV overwrites existing", () => {
    store.setKV("session:main", { id: "old" });
    store.setKV("session:main", { id: "new" });
    const result = store.getKV("session:main");
    assert.deepEqual(result, { id: "new" });
  });

  it("supports various value types", () => {
    store.setKV("string", "hello");
    store.setKV("number", 42);
    store.setKV("boolean", true);
    store.setKV("array", [1, 2, 3]);
    store.setKV("null", null);

    assert.equal(store.getKV("string"), "hello");
    assert.equal(store.getKV("number"), 42);
    assert.equal(store.getKV("boolean"), true);
    assert.deepEqual(store.getKV("array"), [1, 2, 3]);
    assert.equal(store.getKV("null"), null);
  });

  it("cleanup", () => {
    store.close();
    cleanup(dir);
  });
});

// ═══ 3. State Transitions ═════════════════════════════════════════════

describe("State Transitions", () => {
  let store, dir;

  beforeEach(() => {
    ({ store, dir } = createTempStore());
  });

  it("records and queries current state", () => {
    store.commitTransaction([], [{
      entityType: "audit_item",
      entityId: "TN-1",
      fromState: null,
      toState: "review_needed",
      source: "claude-code",
    }], []);

    assert.equal(store.currentState("audit_item", "TN-1"), "review_needed");
  });

  it("tracks state progression", () => {
    store.commitTransaction([], [{
      entityType: "audit_item",
      entityId: "TN-1",
      toState: "review_needed",
      source: "claude-code",
    }], []);

    store.commitTransaction([], [{
      entityType: "audit_item",
      entityId: "TN-1",
      fromState: "review_needed",
      toState: "approved",
      source: "codex",
      metadata: { codes: [], summary: "Looks good" },
    }], []);

    assert.equal(store.currentState("audit_item", "TN-1"), "approved");
  });

  it("handles multiple entities independently", () => {
    store.commitTransaction([], [
      { entityType: "audit_item", entityId: "TN-1", toState: "approved", source: "codex" },
      { entityType: "audit_item", entityId: "TN-2", toState: "changes_requested", source: "codex" },
      { entityType: "gate", entityId: "retro", toState: "blocked", source: "system" },
    ], []);

    assert.equal(store.currentState("audit_item", "TN-1"), "approved");
    assert.equal(store.currentState("audit_item", "TN-2"), "changes_requested");
    assert.equal(store.currentState("gate", "retro"), "blocked");
  });

  it("returns null for unknown entity", () => {
    assert.equal(store.currentState("audit_item", "UNKNOWN"), null);
  });

  it("atomic: events + transitions + kv in one transaction", () => {
    const event = createEvent("audit.verdict", "codex", { verdict: "approved" });
    const ids = store.commitTransaction(
      [event],
      [{ entityType: "audit_item", entityId: "TN-1", toState: "approved", source: "codex" }],
      [{ key: "last_verdict", value: "approved" }],
    );

    assert.equal(ids.length, 1);
    assert.equal(store.currentState("audit_item", "TN-1"), "approved");
    assert.equal(store.getKV("last_verdict"), "approved");
    assert.equal(store.count({ eventType: "audit.verdict" }), 1);
  });

  it("cleanup", () => {
    store.close();
    cleanup(dir);
  });
});

// ═══ 4. TransactionalUnitOfWork ═══════════════════════════════════════

describe("TransactionalUnitOfWork", () => {
  let store, dir;

  beforeEach(() => {
    ({ store, dir } = createTempStore());
  });

  it("stages and commits events + transitions + KV", () => {
    const uow = new TransactionalUnitOfWork(store);

    uow.stageEvent(createEvent("audit.verdict", "codex", { verdict: "approved" }));
    uow.stageTransition({
      entityType: "audit_item",
      entityId: "EV-1",
      toState: "approved",
      source: "codex",
    });
    uow.stageKV("last_action", "approve EV-1");

    assert.equal(uow.size, 3);

    const ids = uow.commit();
    assert.equal(ids.length, 1); // 1 event
    assert.equal(store.currentState("audit_item", "EV-1"), "approved");
    assert.equal(store.getKV("last_action"), "approve EV-1");
  });

  it("rollback clears staged items", () => {
    const uow = new TransactionalUnitOfWork(store);
    uow.stageEvent(createEvent("audit.submit", "claude-code", {}));
    uow.stageTransition({ entityType: "audit_item", entityId: "X", toState: "pending", source: "test" });

    assert.equal(uow.size, 2);
    uow.rollback();
    assert.equal(uow.size, 0);

    // Nothing persisted
    assert.equal(store.count(), 0);
    assert.equal(store.currentState("audit_item", "X"), null);
  });

  it("stages and commits file projections", () => {
    const uow = new TransactionalUnitOfWork(store);
    const testFile = resolve(dir, "projected.md");

    uow.stageEvent(createEvent("evidence.sync", "system", {}));
    uow.stageProjection({
      path: testFile,
      content: "# Projected\n\nThis file was generated from SQLite state.",
    });

    uow.commit();

    // File should exist with correct content
    assert.ok(existsSync(testFile));
    const content = readFileSync(testFile, "utf8");
    assert.ok(content.includes("Projected"));
    assert.ok(content.includes("SQLite state"));
  });

  it("cleans up temp files on SQLite failure", () => {
    // Create a second store pointing to a closed DB to simulate failure
    const uow = new TransactionalUnitOfWork(store);
    const testFile = resolve(dir, "should-not-exist.md");

    uow.stageProjection({ path: testFile, content: "test" });
    uow.stageEvent(createEvent("audit.submit", "claude-code", {}));

    // Close the store to cause SQLite failure
    store.close();

    assert.throws(() => uow.commit());

    // Temp file should have been cleaned up
    assert.ok(!existsSync(testFile + ".quorum-tmp"));
    assert.ok(!existsSync(testFile));
  });

  it("empty commit is no-op", () => {
    const uow = new TransactionalUnitOfWork(store);
    const ids = uow.commit();
    assert.deepEqual(ids, []);
  });

  it("cleanup", () => {
    try { store.close(); } catch {}
    cleanup(dir);
  });
});

// ═══ 5. Bridge Integration (via compiled modules) ═════════════════════

describe("Bridge state management", () => {
  let bridge;

  it("loads bridge module", async () => {
    bridge = await import("../core/bridge.mjs");
    assert.ok(bridge.init);
    assert.ok(bridge.acquireLock);
    assert.ok(bridge.releaseLock);
    assert.ok(bridge.getState);
    assert.ok(bridge.setState);
    assert.ok(bridge.recordTransition);
    assert.ok(bridge.createUnitOfWork);
  });

  it("bridge functions return fail-open defaults before init", () => {
    assert.equal(bridge.acquireLock("test", 1234), false);
    assert.equal(bridge.releaseLock("test", 1234), false);
    assert.equal(bridge.getState("test"), null);
    assert.equal(bridge.setState("test", "value"), false);
    assert.equal(bridge.recordTransition("a", "b", null, "c", "d"), null);
    assert.equal(bridge.createUnitOfWork(), null);
    assert.equal(bridge.isLockHeld("test").held, false);
    assert.equal(bridge.currentState("a", "b"), null);
  });

  it("bridge functions work after init", async () => {
    const ok = await bridge.init(process.cwd());
    if (!ok) {
      // dist/ not available — skip
      return;
    }

    // Lock
    assert.equal(bridge.acquireLock("test:bridge", process.pid), true);
    assert.equal(bridge.isLockHeld("test:bridge").held, true);
    assert.equal(bridge.releaseLock("test:bridge", process.pid), true);

    // KV
    assert.equal(bridge.setState("bridge:test", { hello: "world" }), true);
    assert.deepEqual(bridge.getState("bridge:test"), { hello: "world" });

    // State transition
    const result = bridge.recordTransition("test", "item-1", null, "active", "bridge");
    assert.ok(result !== null);
    assert.equal(bridge.currentState("test", "item-1"), "active");

    // UnitOfWork
    const uow = bridge.createUnitOfWork();
    assert.ok(uow !== null);

    bridge.close();
  });
});
