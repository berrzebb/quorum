#!/usr/bin/env node
/**
 * DUX-6: App Shell and View Registry — runtime tests.
 *
 * Tests VIEW_REGISTRY, shellReducer, initialShellState, and navigation
 * utilities against compiled dist/ output.
 *
 * Run: node --test tests/daemon-shell.test.mjs
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

const {
  VIEW_REGISTRY,
  initialShellState,
  shellReducer,
} = await import("../dist/daemon/shell/app-shell.js");

const {
  viewForKey,
  nextView,
  prevView,
  defaultFocusForView,
} = await import("../dist/daemon/shell/navigation.js");

// ═══ 1. VIEW_REGISTRY ════════════════════════════════════════════════

describe("VIEW_REGISTRY", () => {
  it("IDs are: overview, review, chat, operations", () => {
    const ids = VIEW_REGISTRY.map(v => v.id);
    assert.deepStrictEqual(ids, ["overview", "review", "chat", "operations"]);
  });

  it("shortcuts are: 1, 2, 3, 4", () => {
    const shortcuts = VIEW_REGISTRY.map(v => v.shortcut);
    assert.deepStrictEqual(shortcuts, ["1", "2", "3", "4"]);
  });
});

// ═══ 2. shellReducer ═════════════════════════════════════════════════

describe("shellReducer", () => {
  it("SET_VIEW changes activeView and sets defaultFocus", () => {
    const state = initialShellState();
    const next = shellReducer(state, { type: "SET_VIEW", view: "review" });
    assert.equal(next.activeView, "review");
    assert.equal(next.focusedRegion, "review.findings");
  });

  it("SET_VIEW with 'chat' sets focusedRegion to 'chat.sessions'", () => {
    const state = initialShellState();
    const next = shellReducer(state, { type: "SET_VIEW", view: "chat" });
    assert.equal(next.activeView, "chat");
    assert.equal(next.focusedRegion, "chat.sessions");
  });

  it("SET_FOCUS changes focusedRegion without changing view", () => {
    const state = initialShellState();
    const next = shellReducer(state, { type: "SET_FOCUS", region: "overview.gates" });
    assert.equal(next.focusedRegion, "overview.gates");
    assert.equal(next.activeView, "overview");
  });

  it("SET_OVERLAY changes overlay", () => {
    const state = initialShellState();
    const next = shellReducer(state, { type: "SET_OVERLAY", overlay: "help" });
    assert.equal(next.overlay, "help");
    assert.equal(next.activeView, "overview"); // unchanged
  });

  it("SET_DENSITY changes density", () => {
    const state = initialShellState();
    const next = shellReducer(state, { type: "SET_DENSITY", density: "compact" });
    assert.equal(next.density, "compact");
    assert.equal(next.activeView, "overview"); // unchanged
  });

  it("unknown action returns same state", () => {
    const state = initialShellState();
    // @ts-expect-error — intentionally passing unknown action
    const next = shellReducer(state, { type: "UNKNOWN" });
    assert.deepStrictEqual(next, state);
  });
});

// ═══ 3. initialShellState ════════════════════════════════════════════

describe("initialShellState", () => {
  it("activeView is 'overview'", () => {
    const state = initialShellState();
    assert.equal(state.activeView, "overview");
  });

  it("focusedRegion is 'overview.summary'", () => {
    const state = initialShellState();
    assert.equal(state.focusedRegion, "overview.summary");
  });

  it("overlay is 'none'", () => {
    const state = initialShellState();
    assert.equal(state.overlay, "none");
  });

  it("density is 'comfortable'", () => {
    const state = initialShellState();
    assert.equal(state.density, "comfortable");
  });
});

// ═══ 4. navigation ═══════════════════════════════════════════════════

describe("navigation", () => {
  it("viewForKey('1') returns 'overview'", () => {
    assert.equal(viewForKey("1"), "overview");
  });

  it("viewForKey('3') returns 'chat'", () => {
    assert.equal(viewForKey("3"), "chat");
  });

  it("viewForKey('x') returns null", () => {
    assert.equal(viewForKey("x"), null);
  });

  it("nextView('overview') returns 'review'", () => {
    assert.equal(nextView("overview"), "review");
  });

  it("nextView('operations') wraps to 'overview'", () => {
    assert.equal(nextView("operations"), "overview");
  });

  it("prevView('overview') wraps to 'operations'", () => {
    assert.equal(prevView("overview"), "operations");
  });

  it("defaultFocusForView('chat') returns 'chat.sessions'", () => {
    assert.equal(defaultFocusForView("chat"), "chat.sessions");
  });
});
