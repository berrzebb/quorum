#!/usr/bin/env node
/**
 * DUX-5: Shell-level Poll Scheduler — snapshot diffing + centralized polling.
 *
 * Tests computeSnapshotFingerprint, diffSnapshots, PollScheduler, and PollConfig.
 * Uses mock FullState objects (no SQLite needed).
 *
 * Run: node --test tests/daemon-poller.test.mjs
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

const {
  defaultPollConfig,
  computeSnapshotFingerprint,
  diffSnapshots,
  PollScheduler,
} = await import("../dist/daemon/state/poller.js");

// ── Mock FullState factory ──────────────────────────────────────────

function makeFullState(overrides = {}) {
  return {
    gates: [
      { name: "Audit", status: "open", detail: undefined, since: undefined },
      { name: "Retro", status: "open", detail: undefined, since: undefined },
      { name: "Quality", status: "open", detail: undefined, since: undefined },
    ],
    items: [],
    locks: [],
    specialists: [],
    tracks: [],
    findings: [],
    findingStats: { total: 0, open: 0, confirmed: 0, dismissed: 0, fixed: 0 },
    reviewProgress: [],
    fileThreads: [],
    recentEvents: [],
    fitness: {
      baseline: null,
      current: null,
      gate: null,
      history: [],
      trend: null,
      components: null,
    },
    parliament: {
      committees: [],
      lastVerdict: null,
      pendingAmendments: 0,
      conformance: null,
      sessionCount: 0,
      liveSessions: [],
    },
    agentQueries: [],
    ...overrides,
  };
}

// ═══ 1. PollConfig ═══════════════════════════════════════════════════

describe("PollConfig", () => {
  it("defaultPollConfig returns correct intervals", () => {
    const config = defaultPollConfig();
    assert.equal(config.stateIntervalMs, 1000);
    assert.equal(config.sessionIntervalMs, 2000);
    assert.equal(config.gitIntervalMs, 5000);
  });

  it("defaultPollConfig returns a plain object with exactly 3 keys", () => {
    const config = defaultPollConfig();
    assert.equal(Object.keys(config).length, 3);
    assert.ok("stateIntervalMs" in config);
    assert.ok("sessionIntervalMs" in config);
    assert.ok("gitIntervalMs" in config);
  });
});

// ═══ 2. computeSnapshotFingerprint ═══════════════════════════════════

describe("computeSnapshotFingerprint", () => {
  it("returns a string", () => {
    const state = makeFullState();
    const fp = computeSnapshotFingerprint(state);
    assert.equal(typeof fp, "string");
    assert.ok(fp.length > 0, "fingerprint should not be empty");
  });

  it("same state produces same fingerprint", () => {
    const state1 = makeFullState();
    const state2 = makeFullState();
    assert.equal(
      computeSnapshotFingerprint(state1),
      computeSnapshotFingerprint(state2),
    );
  });

  it("different gate status produces different fingerprint", () => {
    const state1 = makeFullState();
    const state2 = makeFullState({
      gates: [
        { name: "Audit", status: "blocked", detail: "rejected" },
        { name: "Retro", status: "open" },
        { name: "Quality", status: "open" },
      ],
    });
    assert.notEqual(
      computeSnapshotFingerprint(state1),
      computeSnapshotFingerprint(state2),
    );
  });

  it("different item count produces different fingerprint", () => {
    const state1 = makeFullState();
    const state2 = makeFullState({
      items: [{ entityId: "x", currentState: "pending", source: "test", updatedAt: 0 }],
    });
    assert.notEqual(
      computeSnapshotFingerprint(state1),
      computeSnapshotFingerprint(state2),
    );
  });

  it("different finding count produces different fingerprint", () => {
    const state1 = makeFullState();
    const state2 = makeFullState({
      findings: [{ id: "f-1", severity: "high", description: "test", category: "safety", reviewerId: "r", provider: "p", timestamp: 0 }],
    });
    assert.notEqual(
      computeSnapshotFingerprint(state1),
      computeSnapshotFingerprint(state2),
    );
  });

  it("different track progress produces different fingerprint", () => {
    const state1 = makeFullState({
      tracks: [{ trackId: "t1", total: 10, completed: 3, pending: 5, blocked: 2, lastUpdate: 0 }],
    });
    const state2 = makeFullState({
      tracks: [{ trackId: "t1", total: 10, completed: 7, pending: 2, blocked: 1, lastUpdate: 0 }],
    });
    assert.notEqual(
      computeSnapshotFingerprint(state1),
      computeSnapshotFingerprint(state2),
    );
  });

  it("different parliament session count produces different fingerprint", () => {
    const state1 = makeFullState();
    const state2 = makeFullState({
      parliament: {
        committees: [],
        lastVerdict: null,
        pendingAmendments: 0,
        conformance: null,
        sessionCount: 5,
        liveSessions: [],
      },
    });
    assert.notEqual(
      computeSnapshotFingerprint(state1),
      computeSnapshotFingerprint(state2),
    );
  });

  it("different fitness current produces different fingerprint", () => {
    const state1 = makeFullState();
    const state2 = makeFullState({
      fitness: {
        baseline: null,
        current: 0.85,
        gate: null,
        history: [],
        trend: null,
        components: null,
      },
    });
    assert.notEqual(
      computeSnapshotFingerprint(state1),
      computeSnapshotFingerprint(state2),
    );
  });

  it("fingerprint includes lock count", () => {
    const state1 = makeFullState();
    const state2 = makeFullState({
      locks: [{ held: true, lockName: "audit", owner: 1234, acquiredAt: Date.now(), ttlMs: 60000 }],
    });
    assert.notEqual(
      computeSnapshotFingerprint(state1),
      computeSnapshotFingerprint(state2),
    );
  });
});

// ═══ 3. diffSnapshots ═══════════════════════════════════════════════

describe("diffSnapshots", () => {
  it("null prev → all sections changed", () => {
    const state = makeFullState();
    const diff = diffSnapshots(null, state);
    assert.equal(diff.changed, true);
    assert.equal(typeof diff.fingerprint, "string");
    assert.ok(diff.changedSections instanceof Set);
    // Should include all 12 sections
    const expectedSections = [
      "gates", "items", "findings", "tracks",
      "events", "parliament", "locks", "fitness",
      "specialists", "reviewProgress", "fileThreads", "agentQueries",
    ];
    for (const section of expectedSections) {
      assert.ok(diff.changedSections.has(section), `Missing section: ${section}`);
    }
    assert.equal(diff.changedSections.size, 12);
  });

  it("same state → no sections changed", () => {
    const state = makeFullState();
    const diff = diffSnapshots(state, state);
    assert.equal(diff.changed, false);
    assert.equal(diff.changedSections.size, 0);
  });

  it("gate status change → 'gates' in changedSections", () => {
    const prev = makeFullState();
    const next = makeFullState({
      gates: [
        { name: "Audit", status: "blocked" },
        { name: "Retro", status: "open" },
        { name: "Quality", status: "open" },
      ],
    });
    const diff = diffSnapshots(prev, next);
    assert.equal(diff.changed, true);
    assert.ok(diff.changedSections.has("gates"));
  });

  it("gate count change → 'gates' in changedSections", () => {
    const prev = makeFullState();
    const next = makeFullState({
      gates: [
        { name: "Audit", status: "open" },
        { name: "Retro", status: "open" },
      ],
    });
    const diff = diffSnapshots(prev, next);
    assert.ok(diff.changedSections.has("gates"));
  });

  it("item count change → 'items' in changedSections", () => {
    const prev = makeFullState();
    const next = makeFullState({
      items: [{ entityId: "x", currentState: "pending", source: "test", updatedAt: 0 }],
    });
    const diff = diffSnapshots(prev, next);
    assert.equal(diff.changed, true);
    assert.ok(diff.changedSections.has("items"));
  });

  it("finding count change → 'findings' in changedSections", () => {
    const prev = makeFullState();
    const next = makeFullState({
      findings: [{ id: "f-1", severity: "high", description: "test", category: "safety", reviewerId: "r", provider: "p", timestamp: 0 }],
    });
    const diff = diffSnapshots(prev, next);
    assert.equal(diff.changed, true);
    assert.ok(diff.changedSections.has("findings"));
  });

  it("track progress change → 'tracks' in changedSections", () => {
    const prev = makeFullState({
      tracks: [{ trackId: "t1", total: 10, completed: 3, pending: 5, blocked: 2, lastUpdate: 0 }],
    });
    const next = makeFullState({
      tracks: [{ trackId: "t1", total: 10, completed: 7, pending: 2, blocked: 1, lastUpdate: 0 }],
    });
    const diff = diffSnapshots(prev, next);
    assert.equal(diff.changed, true);
    assert.ok(diff.changedSections.has("tracks"));
  });

  it("track count change → 'tracks' in changedSections", () => {
    const prev = makeFullState();
    const next = makeFullState({
      tracks: [{ trackId: "t1", total: 5, completed: 0, pending: 5, blocked: 0, lastUpdate: 0 }],
    });
    const diff = diffSnapshots(prev, next);
    assert.ok(diff.changedSections.has("tracks"));
  });

  it("event count change → 'events' in changedSections", () => {
    const prev = makeFullState();
    const next = makeFullState({
      recentEvents: [{ type: "audit.start", source: "test", timestamp: Date.now(), payload: {} }],
    });
    const diff = diffSnapshots(prev, next);
    assert.equal(diff.changed, true);
    assert.ok(diff.changedSections.has("events"));
  });

  it("parliament sessionCount change → 'parliament' in changedSections", () => {
    const prev = makeFullState();
    const next = makeFullState({
      parliament: {
        committees: [],
        lastVerdict: null,
        pendingAmendments: 0,
        conformance: null,
        sessionCount: 3,
        liveSessions: [],
      },
    });
    const diff = diffSnapshots(prev, next);
    assert.equal(diff.changed, true);
    assert.ok(diff.changedSections.has("parliament"));
  });

  it("lock count change → 'locks' in changedSections", () => {
    const prev = makeFullState();
    const next = makeFullState({
      locks: [{ held: true, lockName: "audit", owner: 1234, acquiredAt: Date.now(), ttlMs: 60000 }],
    });
    const diff = diffSnapshots(prev, next);
    assert.equal(diff.changed, true);
    assert.ok(diff.changedSections.has("locks"));
  });

  it("fitness change → 'fitness' in changedSections", () => {
    const prev = makeFullState();
    const next = makeFullState({
      fitness: {
        baseline: null,
        current: 0.85,
        gate: null,
        history: [],
        trend: null,
        components: null,
      },
    });
    const diff = diffSnapshots(prev, next);
    assert.equal(diff.changed, true);
    assert.ok(diff.changedSections.has("fitness"));
  });

  it("specialist count change → 'specialists' in changedSections", () => {
    const prev = makeFullState();
    const next = makeFullState({
      specialists: [{ domain: "perf", tool: "perf_scan", toolStatus: "pass", timestamp: 0 }],
    });
    const diff = diffSnapshots(prev, next);
    assert.equal(diff.changed, true);
    assert.ok(diff.changedSections.has("specialists"));
  });

  it("findingStats total change → 'findingStats' in changedSections", () => {
    const prev = makeFullState();
    const next = makeFullState({
      findingStats: { total: 5, open: 3, confirmed: 1, dismissed: 1, fixed: 0 },
    });
    const diff = diffSnapshots(prev, next);
    assert.equal(diff.changed, true);
    assert.ok(diff.changedSections.has("findingStats"));
  });

  it("multiple changes detected together", () => {
    const prev = makeFullState();
    const next = makeFullState({
      gates: [
        { name: "Audit", status: "blocked" },
        { name: "Retro", status: "blocked" },
        { name: "Quality", status: "open" },
      ],
      items: [{ entityId: "x", currentState: "pending", source: "test", updatedAt: 0 }],
      findings: [{ id: "f-1", severity: "high", description: "test", category: "safety", reviewerId: "r", provider: "p", timestamp: 0 }],
      locks: [{ held: true, lockName: "audit", owner: 1234, acquiredAt: Date.now(), ttlMs: 60000 }],
    });
    const diff = diffSnapshots(prev, next);
    assert.equal(diff.changed, true);
    assert.ok(diff.changedSections.has("gates"));
    assert.ok(diff.changedSections.has("items"));
    assert.ok(diff.changedSections.has("findings"));
    assert.ok(diff.changedSections.has("locks"));
    assert.ok(diff.changedSections.size >= 4);
  });

  it("diff fingerprint matches computeSnapshotFingerprint", () => {
    const state = makeFullState();
    const diff = diffSnapshots(null, state);
    assert.equal(diff.fingerprint, computeSnapshotFingerprint(state));
  });
});

// ═══ 4. PollScheduler ═══════════════════════════════════════════════

describe("PollScheduler", () => {
  it("running is false initially", () => {
    const scheduler = new PollScheduler();
    assert.equal(scheduler.running, false);
  });

  it("startStatePolling sets running to true", () => {
    const scheduler = new PollScheduler({ stateIntervalMs: 100_000 });
    scheduler.startStatePolling(() => makeFullState(), () => {});
    assert.equal(scheduler.running, true);
    scheduler.stop();
  });

  it("stop sets running to false", () => {
    const scheduler = new PollScheduler({ stateIntervalMs: 100_000 });
    scheduler.startStatePolling(() => makeFullState(), () => {});
    assert.equal(scheduler.running, true);
    scheduler.stop();
    assert.equal(scheduler.running, false);
  });

  it("stop is idempotent", () => {
    const scheduler = new PollScheduler();
    scheduler.stop();
    scheduler.stop();
    assert.equal(scheduler.running, false);
  });

  it("getConfig returns copy of config", () => {
    const scheduler = new PollScheduler({ stateIntervalMs: 500 });
    const config = scheduler.getConfig();
    assert.equal(config.stateIntervalMs, 500);
    assert.equal(config.sessionIntervalMs, 2000); // default
    assert.equal(config.gitIntervalMs, 5000); // default
    // Verify it's a copy
    config.stateIntervalMs = 999;
    assert.equal(scheduler.getConfig().stateIntervalMs, 500);
  });

  it("custom config merges with defaults", () => {
    const scheduler = new PollScheduler({ gitIntervalMs: 10000 });
    const config = scheduler.getConfig();
    assert.equal(config.stateIntervalMs, 1000); // default
    assert.equal(config.sessionIntervalMs, 2000); // default
    assert.equal(config.gitIntervalMs, 10000); // custom
  });

  it("startStatePolling does not start twice", () => {
    const scheduler = new PollScheduler({ stateIntervalMs: 100_000 });
    let callCount = 0;
    const readState = () => { callCount++; return makeFullState(); };
    scheduler.startStatePolling(readState, () => {});
    scheduler.startStatePolling(readState, () => {}); // second call should be ignored
    assert.equal(scheduler.running, true);
    scheduler.stop();
  });

  it("onUpdate is called when state changes (immediate callback via short interval)", async () => {
    let updateCount = 0;
    let receivedDiff = null;
    let callIndex = 0;

    const scheduler = new PollScheduler({ stateIntervalMs: 10 });

    const states = [
      makeFullState(), // first call: always triggers (prev is null)
      makeFullState(), // second call: same state, no trigger
      makeFullState({ items: [{ entityId: "x", currentState: "pending", source: "test", updatedAt: 0 }] }), // third: change
    ];

    scheduler.startStatePolling(
      () => {
        const idx = Math.min(callIndex++, states.length - 1);
        return states[idx];
      },
      (_state, diff) => {
        updateCount++;
        receivedDiff = diff;
      },
    );

    // Wait for a few polling cycles
    await new Promise(resolve => setTimeout(resolve, 100));
    scheduler.stop();

    // Should have been called at least twice (first + changed state)
    assert.ok(updateCount >= 2, `Expected at least 2 updates, got ${updateCount}`);
    // Last diff should include "items" change
    assert.ok(receivedDiff !== null, "Should have received a diff");
    assert.ok(receivedDiff.changedSections.has("items"), "Last diff should include items change");
  });

  it("onUpdate is NOT called when state is unchanged", async () => {
    let updateCount = 0;
    const unchangingState = makeFullState();

    const scheduler = new PollScheduler({ stateIntervalMs: 10 });

    scheduler.startStatePolling(
      () => unchangingState,
      () => { updateCount++; },
    );

    // Wait for several polling cycles
    await new Promise(resolve => setTimeout(resolve, 80));
    scheduler.stop();

    // Should be called exactly once (the initial null → state transition)
    assert.equal(updateCount, 1, `Expected exactly 1 update (initial), got ${updateCount}`);
  });

  it("no config creates defaults", () => {
    const scheduler = new PollScheduler();
    const config = scheduler.getConfig();
    assert.equal(config.stateIntervalMs, 1000);
    assert.equal(config.sessionIntervalMs, 2000);
    assert.equal(config.gitIntervalMs, 5000);
  });
});
