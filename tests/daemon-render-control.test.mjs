#!/usr/bin/env node
/**
 * DUX-14: Render Control — debounce + timer registry tests.
 *
 * Run: node --test tests/daemon-render-control.test.mjs
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

const {
  createRenderDebounce,
  TimerRegistry,
} = await import("../dist/daemon/state/render-control.js");

// ═══ 1. createRenderDebounce ═════════════════════════════════════════

describe("createRenderDebounce", () => {
  it("returns schedule and cancel functions", () => {
    const db = createRenderDebounce(50);
    assert.equal(typeof db.schedule, "function");
    assert.equal(typeof db.cancel, "function");
  });

  it("schedule invokes callback after delay", async () => {
    const db = createRenderDebounce(30);
    let called = false;
    db.schedule(() => { called = true; });
    assert.equal(called, false, "should not fire synchronously");
    await new Promise(r => setTimeout(r, 60));
    assert.equal(called, true, "should fire after delay");
  });

  it("cancel prevents pending callback", async () => {
    const db = createRenderDebounce(30);
    let called = false;
    db.schedule(() => { called = true; });
    db.cancel();
    await new Promise(r => setTimeout(r, 60));
    assert.equal(called, false, "should not fire after cancel");
  });

  it("schedule replaces previous pending callback", async () => {
    const db = createRenderDebounce(30);
    let first = false;
    let second = false;
    db.schedule(() => { first = true; });
    db.schedule(() => { second = true; });
    await new Promise(r => setTimeout(r, 60));
    assert.equal(first, false, "first callback should be replaced");
    assert.equal(second, true, "second callback should fire");
  });
});

// ═══ 2. TimerRegistry ════════════════════════════════════════════════

describe("TimerRegistry", () => {
  it("register and has", () => {
    const reg = new TimerRegistry();
    reg.register("t1", () => {}, 10000);
    assert.equal(reg.has("t1"), true);
    reg.unregisterAll();
  });

  it("unregister removes timer", () => {
    const reg = new TimerRegistry();
    reg.register("t1", () => {}, 10000);
    reg.unregister("t1");
    assert.equal(reg.has("t1"), false);
    assert.equal(reg.activeCount(), 0);
  });

  it("unregisterAll clears all timers", () => {
    const reg = new TimerRegistry();
    reg.register("a", () => {}, 10000);
    reg.register("b", () => {}, 10000);
    reg.register("c", () => {}, 10000);
    assert.equal(reg.activeCount(), 3);
    reg.unregisterAll();
    assert.equal(reg.activeCount(), 0);
  });

  it("activeCount reflects registered timers", () => {
    const reg = new TimerRegistry();
    assert.equal(reg.activeCount(), 0);
    reg.register("x", () => {}, 10000);
    assert.equal(reg.activeCount(), 1);
    reg.register("y", () => {}, 10000);
    assert.equal(reg.activeCount(), 2);
    reg.unregisterAll();
  });

  it("has returns false for unknown id", () => {
    const reg = new TimerRegistry();
    assert.equal(reg.has("nonexistent"), false);
  });

  it("duplicate register replaces old timer", () => {
    const reg = new TimerRegistry();
    let count1 = 0;
    let count2 = 0;
    reg.register("dup", () => { count1++; }, 10000);
    reg.register("dup", () => { count2++; }, 10000);
    assert.equal(reg.activeCount(), 1, "should still have only 1 timer");
    assert.equal(reg.has("dup"), true);
    reg.unregisterAll();
  });

  it("unregister non-existent is safe", () => {
    const reg = new TimerRegistry();
    // should not throw
    reg.unregister("does-not-exist");
    assert.equal(reg.activeCount(), 0);
  });
});
