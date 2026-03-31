/**
 * Tests for Daemon Store (SDK-9).
 *
 * Verifies subscription-based state management adopted from
 * Claude Code AppStateStore pattern.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

const { createStore } = await import("../dist/daemon/state/store.js");

/** Minimal FullState for testing. */
function makeState(overrides = {}) {
  return {
    gates: [],
    items: [],
    locks: [],
    specialists: [],
    tracks: [],
    findings: [],
    findingStats: { total: 0, open: 0, resolved: 0 },
    reviewProgress: [],
    fileThreads: [],
    recentEvents: [],
    fitness: { score: 0, components: {} },
    parliament: { sessions: [], committees: [], pendingAmendments: 0, liveSessionCount: 0 },
    agentQueries: [],
    ...overrides,
  };
}

// ── Basic operations ────────────────────────────────

describe("Daemon Store — basic operations", () => {
  it("getState returns initial state", () => {
    const store = createStore(makeState({ gates: [{ name: "test" }] }));
    assert.equal(store.getState().gates.length, 1);
  });

  it("setState replaces state", () => {
    const store = createStore(makeState());
    store.setState(makeState({ gates: [{ name: "a" }, { name: "b" }] }));
    assert.equal(store.getState().gates.length, 2);
  });

  it("update applies producer function", () => {
    const store = createStore(makeState({ gates: [{ name: "x" }] }));
    store.update(prev => ({ ...prev, gates: [...prev.gates, { name: "y" }] }));
    assert.equal(store.getState().gates.length, 2);
  });
});

// ── Subscriptions ───────────────────────────────────

describe("Daemon Store — subscriptions", () => {
  it("subscribe fires listener when slice changes", () => {
    const store = createStore(makeState());
    let called = 0;
    store.subscribe(s => s.gates, () => { called++; });
    store.setState(makeState({ gates: [{ name: "new" }] }));
    assert.equal(called, 1);
  });

  it("subscribe does NOT fire when slice unchanged (same reference)", () => {
    const gates = [{ name: "stable" }];
    const store = createStore(makeState({ gates }));
    let called = 0;
    store.subscribe(s => s.gates, () => { called++; });
    // Set state with the same gates array reference
    store.setState(makeState({ gates }));
    assert.equal(called, 0, "should not fire when same reference");
  });

  it("subscribe does NOT fire for unrelated slice changes", () => {
    const store = createStore(makeState());
    let gatesCalled = 0;
    store.subscribe(s => s.gates, () => { gatesCalled++; });
    // Only change items, not gates
    store.setState(makeState({ items: [{ id: "1" }] }));
    assert.equal(gatesCalled, 0, "gates listener should not fire for items change");
  });

  it("multiple subscribers fire independently", () => {
    const store = createStore(makeState());
    let gatesCalled = 0;
    let itemsCalled = 0;
    store.subscribe(s => s.gates, () => { gatesCalled++; });
    store.subscribe(s => s.items, () => { itemsCalled++; });

    store.setState(makeState({ gates: [{ name: "g" }] }));
    assert.equal(gatesCalled, 1);
    assert.equal(itemsCalled, 0);

    store.setState(makeState({ gates: [{ name: "g" }], items: [{ id: "1" }] }));
    assert.equal(itemsCalled, 1);
  });

  it("unsubscribe stops listener", () => {
    const store = createStore(makeState());
    let called = 0;
    const sub = store.subscribe(s => s.gates, () => { called++; });
    store.setState(makeState({ gates: [{ name: "a" }] }));
    assert.equal(called, 1);

    sub.unsubscribe();
    store.setState(makeState({ gates: [{ name: "b" }] }));
    assert.equal(called, 1, "should not fire after unsubscribe");
  });

  it("subscribeAll fires on every setState", () => {
    const store = createStore(makeState());
    let called = 0;
    store.subscribeAll(() => { called++; });
    store.setState(makeState());
    store.setState(makeState());
    assert.equal(called, 2);
  });

  it("subscriberCount tracks active subscriptions", () => {
    const store = createStore(makeState());
    assert.equal(store.subscriberCount(), 0);
    const s1 = store.subscribe(s => s.gates, () => {});
    const s2 = store.subscribe(s => s.items, () => {});
    assert.equal(store.subscriberCount(), 2);
    s1.unsubscribe();
    assert.equal(store.subscriberCount(), 1);
    s2.unsubscribe();
    assert.equal(store.subscriberCount(), 0);
  });
});

// ── Listener receives prev and next ─────────────────

describe("Daemon Store — listener arguments", () => {
  it("listener receives (nextSlice, prevSlice)", () => {
    const store = createStore(makeState({ gates: [] }));
    let receivedPrev, receivedNext;
    store.subscribe(s => s.gates, (next, prev) => {
      receivedNext = next;
      receivedPrev = prev;
    });
    const newGates = [{ name: "new" }];
    store.setState(makeState({ gates: newGates }));
    assert.deepEqual(receivedPrev, []);
    assert.equal(receivedNext, newGates);
  });
});

// ── Destroy ─────────────────────────────────────────

describe("Daemon Store — destroy", () => {
  it("destroy removes all subscriptions", () => {
    const store = createStore(makeState());
    let called = 0;
    store.subscribe(s => s.gates, () => { called++; });
    store.destroy();
    store.setState(makeState({ gates: [{ name: "x" }] }));
    assert.equal(called, 0, "should not fire after destroy");
    assert.equal(store.subscriberCount(), 0);
  });
});

// ── Error resilience ────────────────────────────────

describe("Daemon Store — error resilience", () => {
  it("subscriber error does not break other subscribers", () => {
    const store = createStore(makeState());
    let called = 0;
    store.subscribe(s => s.gates, () => { throw new Error("boom"); });
    store.subscribe(s => s.gates, () => { called++; });
    store.setState(makeState({ gates: [{ name: "x" }] }));
    assert.equal(called, 1, "second subscriber should still fire");
  });
});

// ── Scalar selector ─────────────────────────────────

describe("Daemon Store — scalar selectors", () => {
  it("works with scalar selectors (fitness score)", () => {
    const store = createStore(makeState({ fitness: { score: 0.5, components: {} } }));
    let latestScore = 0;
    store.subscribe(s => s.fitness.score, (score) => { latestScore = score; });
    store.setState(makeState({ fitness: { score: 0.85, components: {} } }));
    assert.equal(latestScore, 0.85);
  });

  it("scalar selector does not fire when value unchanged", () => {
    const store = createStore(makeState({ fitness: { score: 0.7, components: {} } }));
    let called = 0;
    store.subscribe(s => s.fitness.score, () => { called++; });
    store.setState(makeState({ fitness: { score: 0.7, components: {} } }));
    assert.equal(called, 0);
  });
});
