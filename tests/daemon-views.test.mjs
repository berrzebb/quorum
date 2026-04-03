#!/usr/bin/env node
/**
 * DUX-8: View component contract tests.
 *
 * Validates:
 * 1. View files exist under daemon/views/
 * 2. VIEW_REGISTRY entries match view file names ({id}-view.tsx)
 * 3. shellReducer SET_VIEW produces correct defaultFocus for each view
 * 4. viewForKey maps 1->overview, 2->review, 3->chat, 4->operations
 * 5. View exports exist in compiled output
 *
 * Run: node --test tests/daemon-views.test.mjs
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

// ── Imports from compiled dist/ ──────────────────────────────────────

const {
  VIEW_REGISTRY,
  initialShellState,
  shellReducer,
} = await import("../dist/daemon/shell/app-shell.js");

const {
  viewForKey,
} = await import("../dist/daemon/shell/navigation.js");

// ═══ 1. View file existence ═════════════════════════════════════════

describe("View file existence", () => {
  const expectedViews = ["overview", "review", "chat", "operations"];

  for (const viewId of expectedViews) {
    it(`daemon/views/${viewId}-view.tsx exists`, () => {
      const viewPath = resolve("daemon", "views", `${viewId}-view.tsx`);
      assert.ok(existsSync(viewPath), `Missing view file: daemon/views/${viewId}-view.tsx`);
    });
  }

});

// ═══ 2. VIEW_REGISTRY matches view files ════════════════════════════

describe("VIEW_REGISTRY matches view files", () => {
  it("each VIEW_REGISTRY entry has a matching {id}-view.tsx file", () => {
    for (const entry of VIEW_REGISTRY) {
      const viewPath = resolve("daemon", "views", `${entry.id}-view.tsx`);
      assert.ok(
        existsSync(viewPath),
        `VIEW_REGISTRY entry "${entry.id}" has no matching file: daemon/views/${entry.id}-view.tsx`,
      );
    }
  });

});

// ═══ 3. shellReducer SET_VIEW defaultFocus ══════════════════════════

describe("shellReducer SET_VIEW defaultFocus", () => {
  const expectedFocus = {
    overview: "overview.summary",
    review: "review.findings",
    chat: "chat.sessions",
    operations: "operations.providers",
  };

  for (const [viewId, expectedRegion] of Object.entries(expectedFocus)) {
    it(`SET_VIEW "${viewId}" sets focusedRegion to "${expectedRegion}"`, () => {
      const state = initialShellState();
      const next = shellReducer(state, { type: "SET_VIEW", view: viewId });
      assert.equal(next.activeView, viewId);
      assert.equal(next.focusedRegion, expectedRegion);
    });
  }

  it("SET_VIEW for all 4 views produces non-null focusedRegion", () => {
    for (const viewId of ["overview", "review", "chat", "operations"]) {
      const state = initialShellState();
      const next = shellReducer(state, { type: "SET_VIEW", view: viewId });
      assert.ok(next.focusedRegion !== null, `SET_VIEW "${viewId}" produced null focusedRegion`);
    }
  });
});

// ═══ 4. viewForKey mapping ══════════════════════════════════════════

describe("viewForKey mapping", () => {
  it("key '1' maps to 'overview'", () => {
    assert.equal(viewForKey("1"), "overview");
  });

  it("key '2' maps to 'review'", () => {
    assert.equal(viewForKey("2"), "review");
  });

  it("key '3' maps to 'chat'", () => {
    assert.equal(viewForKey("3"), "chat");
  });

  it("key '4' maps to 'operations'", () => {
    assert.equal(viewForKey("4"), "operations");
  });

  it("key '5' returns null (no 5th view)", () => {
    assert.equal(viewForKey("5"), null);
  });

  it("all 4 keys resolve to distinct views", () => {
    const views = ["1", "2", "3", "4"].map(k => viewForKey(k));
    assert.equal(new Set(views).size, 4, "All 4 keys should resolve to distinct views");
  });
});

// ═══ 5. View exports from compiled output ═══════════════════════════

describe("View exports from compiled output", () => {
  it("OverviewView is exported from dist/daemon/views/overview-view.js", async () => {
    const mod = await import("../dist/daemon/views/overview-view.js");
    assert.equal(typeof mod.OverviewView, "function", "OverviewView should be a function");
  });

  it("ReviewView is exported from dist/daemon/views/review-view.js", async () => {
    const mod = await import("../dist/daemon/views/review-view.js");
    assert.equal(typeof mod.ReviewView, "function", "ReviewView should be a function");
  });

  it("ChatView is exported from dist/daemon/views/chat-view.js", async () => {
    const mod = await import("../dist/daemon/views/chat-view.js");
    assert.equal(typeof mod.ChatView, "function", "ChatView should be a function");
  });

  it("OperationsView is exported from dist/daemon/views/operations-view.js", async () => {
    const mod = await import("../dist/daemon/views/operations-view.js");
    assert.equal(typeof mod.OperationsView, "function", "OperationsView should be a function");
  });
});

// ═══ 6. View-registry-to-file consistency ═══════════════════════════

describe("View-registry-to-file consistency", () => {
  it("each VIEW_REGISTRY entry has a non-empty title", () => {
    for (const entry of VIEW_REGISTRY) {
      assert.ok(entry.title.length > 0, `VIEW_REGISTRY entry "${entry.id}" has empty title`);
    }
  });
});
