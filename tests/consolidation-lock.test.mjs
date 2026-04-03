#!/usr/bin/env node
/**
 * RDI-2: Consolidation Lock with Stale Reclaim and Rollback
 *
 * Run: node --test tests/consolidation-lock.test.mjs
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";

const {
  tryAcquire,
  release,
  rollback,
  reclaimStale,
  checkLock,
  getLastConsolidatedAt,
  persistConsolidationTimestamp,
  LOCK_FILE_NAME,
  DEFAULT_STALE_TIMEOUT_MS,
} = await import("../platform/core/retro/consolidation-lock.mjs");

let testDir;

beforeEach(() => {
  testDir = resolve(tmpdir(), `quorum-lock-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testDir, { recursive: true });
});

afterEach(() => {
  try {
    if (testDir) rmSync(testDir, { recursive: true, force: true });
  } catch { /* ok */ }
});

// ═══ Lock Acquire ══════════════════════════════════════

describe("RDI-2: tryAcquire", () => {
  it("acquires lock when no existing lock", () => {
    const result = tryAcquire(testDir);
    assert.equal(result.acquired, true);
    assert.ok(result.handle);
    assert.equal(result.handle.holderPid, process.pid);
    assert.equal(result.reason, "lock acquired");
    assert.ok(existsSync(resolve(testDir, LOCK_FILE_NAME)));
  });

  it("rejects when live process holds lock", () => {
    // First acquire
    const first = tryAcquire(testDir);
    assert.equal(first.acquired, true);

    // Second acquire (same PID — still alive)
    const second = tryAcquire(testDir);
    assert.equal(second.acquired, false);
    assert.ok(second.reason.includes("live process"));
  });

  it("reports stale lock from dead process", () => {
    // Simulate a lock from a dead PID (PID 999999 is very unlikely to exist)
    const lockPath = resolve(testDir, LOCK_FILE_NAME);
    writeFileSync(lockPath, JSON.stringify({
      pid: 999999,
      acquiredAt: Date.now() - DEFAULT_STALE_TIMEOUT_MS - 1000,
      lastConsolidatedAt: 0,
    }), "utf8");

    const result = tryAcquire(testDir);
    assert.equal(result.acquired, false);
    assert.ok(result.reason.includes("stale lock") || result.reason.includes("reclaimStale"));
  });

  it("creates directory if it does not exist", () => {
    const nestedDir = resolve(testDir, "deep", "nested", "lock");
    const result = tryAcquire(nestedDir);
    assert.equal(result.acquired, true);
    assert.ok(existsSync(resolve(nestedDir, LOCK_FILE_NAME)));
  });
});

// ═══ Lock Release ══════════════════════════════════════

describe("RDI-2: release", () => {
  it("removes lock file on release", () => {
    const acq = tryAcquire(testDir);
    assert.equal(acq.acquired, true);

    const result = release(acq.handle);
    assert.equal(result.released, true);
    assert.ok(result.lastConsolidatedAt > 0);
    assert.equal(existsSync(resolve(testDir, LOCK_FILE_NAME)), false);
  });

  it("returns custom consolidation timestamp", () => {
    const acq = tryAcquire(testDir);
    const ts = 1700000000000;
    const result = release(acq.handle, ts);
    assert.equal(result.lastConsolidatedAt, ts);
  });

  it("handles already-removed lock gracefully", () => {
    const acq = tryAcquire(testDir);
    rmSync(resolve(testDir, LOCK_FILE_NAME), { force: true });
    const result = release(acq.handle);
    assert.equal(result.released, true);
  });
});

// ═══ Rollback ══════════════════════════════════════════

describe("RDI-2: rollback", () => {
  it("removes lock and restores prior mtime", () => {
    const acq = tryAcquire(testDir);
    const result = rollback(acq.handle);
    assert.equal(result.rolledBack, true);
    assert.equal(result.restoredMtime, acq.handle.priorMtime);
    assert.equal(existsSync(resolve(testDir, LOCK_FILE_NAME)), false);
  });

  it("handles missing lock gracefully", () => {
    const acq = tryAcquire(testDir);
    rmSync(resolve(testDir, LOCK_FILE_NAME), { force: true });
    const result = rollback(acq.handle);
    assert.equal(result.rolledBack, true);
  });
});

// ═══ Stale Reclaim ═════════════════════════════════════

describe("RDI-2: reclaimStale", () => {
  it("returns false when no lock exists", () => {
    const result = reclaimStale(testDir);
    assert.equal(result.reclaimed, false);
    assert.ok(result.reason.includes("no lock"));
  });

  it("refuses to reclaim from live process", () => {
    tryAcquire(testDir);
    const result = reclaimStale(testDir);
    assert.equal(result.reclaimed, false);
    assert.ok(result.reason.includes("alive"));
  });

  it("reclaims stale lock from dead process", () => {
    const lockPath = resolve(testDir, LOCK_FILE_NAME);
    writeFileSync(lockPath, JSON.stringify({
      pid: 999999,
      acquiredAt: Date.now() - DEFAULT_STALE_TIMEOUT_MS - 1000,
      lastConsolidatedAt: 0,
    }), "utf8");

    const result = reclaimStale(testDir);
    assert.equal(result.reclaimed, true);
    assert.ok(result.reason.includes("reclaimed"));
    assert.equal(existsSync(lockPath), false);
  });

  it("refuses reclaim when not yet stale", () => {
    const lockPath = resolve(testDir, LOCK_FILE_NAME);
    writeFileSync(lockPath, JSON.stringify({
      pid: 999999,
      acquiredAt: Date.now() - 1000, // 1 second ago (not stale)
      lastConsolidatedAt: 0,
    }), "utf8");

    const result = reclaimStale(testDir);
    assert.equal(result.reclaimed, false);
    assert.ok(result.reason.includes("not stale"));
  });

  it("reclaims corrupt lock file", () => {
    const lockPath = resolve(testDir, LOCK_FILE_NAME);
    writeFileSync(lockPath, "NOT JSON", "utf8");

    const result = reclaimStale(testDir);
    assert.equal(result.reclaimed, true);
    assert.ok(result.reason.includes("corrupt"));
  });
});

// ═══ Check Lock ════════════════════════════════════════

describe("RDI-2: checkLock", () => {
  it("returns unlocked when no lock file", () => {
    const result = checkLock(testDir);
    assert.equal(result.locked, false);
  });

  it("returns locked with live holder info", () => {
    tryAcquire(testDir);
    const result = checkLock(testDir);
    assert.equal(result.locked, true);
    assert.equal(result.holder, process.pid);
    assert.equal(result.alive, true);
  });

  it("reports dead holder", () => {
    const lockPath = resolve(testDir, LOCK_FILE_NAME);
    writeFileSync(lockPath, JSON.stringify({
      pid: 999999,
      acquiredAt: Date.now(),
      lastConsolidatedAt: 0,
    }), "utf8");

    const result = checkLock(testDir);
    assert.equal(result.locked, true);
    assert.equal(result.holder, 999999);
    assert.equal(result.alive, false);
  });
});

// ═══ Consolidation Timestamp ═══════════════════════════

describe("RDI-2: consolidation timestamp", () => {
  it("returns 0 when never consolidated", () => {
    assert.equal(getLastConsolidatedAt(testDir), 0);
  });

  it("reads persisted timestamp", () => {
    persistConsolidationTimestamp(testDir, 1700000000000);
    assert.equal(getLastConsolidatedAt(testDir), 1700000000000);
  });

  it("acquire + release + persist cycle", () => {
    const acq = tryAcquire(testDir);
    const ts = Date.now();
    release(acq.handle, ts);
    persistConsolidationTimestamp(testDir, ts);
    assert.equal(getLastConsolidatedAt(testDir), ts);
  });
});

// ═══ Full Lifecycle ════════════════════════════════════

describe("RDI-2: full lifecycle", () => {
  it("acquire → success → release → reacquire", () => {
    const first = tryAcquire(testDir);
    assert.equal(first.acquired, true);

    release(first.handle);
    assert.equal(existsSync(resolve(testDir, LOCK_FILE_NAME)), false);

    const second = tryAcquire(testDir);
    assert.equal(second.acquired, true);
  });

  it("acquire → failure → rollback → reacquire", () => {
    const first = tryAcquire(testDir);
    assert.equal(first.acquired, true);

    rollback(first.handle);
    assert.equal(existsSync(resolve(testDir, LOCK_FILE_NAME)), false);

    const second = tryAcquire(testDir);
    assert.equal(second.acquired, true);
  });

  it("dead lock → reclaim → acquire", () => {
    const lockPath = resolve(testDir, LOCK_FILE_NAME);
    writeFileSync(lockPath, JSON.stringify({
      pid: 999999,
      acquiredAt: Date.now() - DEFAULT_STALE_TIMEOUT_MS - 1000,
      lastConsolidatedAt: 0,
    }), "utf8");

    const reclaim = reclaimStale(testDir);
    assert.equal(reclaim.reclaimed, true);

    const acq = tryAcquire(testDir);
    assert.equal(acq.acquired, true);
  });
});
