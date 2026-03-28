#!/usr/bin/env node
/**
 * DUX-7: Focus Manager, Shortcut Registry — runtime tests.
 *
 * Tests FOCUS_REGIONS, FOCUS_CYCLES, cycle navigation, shortcuts,
 * effective shortcuts, footer hints, and key collision detection
 * against compiled dist/ output.
 *
 * Run: node --test tests/daemon-focus-shortcuts.test.mjs
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

const {
  FOCUS_REGIONS,
  FOCUS_CYCLES,
  nextFocusInCycle,
  prevFocusInCycle,
  regionsForView,
  adjustedChatCycle,
} = await import("../dist/daemon/shell/focus-regions.js");

const {
  GLOBAL_SHORTCUTS,
  CHAT_SHORTCUTS,
  getEffectiveShortcuts,
  getFooterHints,
  findKeyCollisions,
} = await import("../dist/daemon/shell/shortcuts.js");

// ═══ 1. FOCUS_REGIONS ══════════════════════════════════════════════════

describe("FOCUS_REGIONS", () => {
  it("has exactly 16 regions", () => {
    assert.equal(FOCUS_REGIONS.length, 16);
  });

  it("each has id, scope, purpose", () => {
    for (const region of FOCUS_REGIONS) {
      assert.ok("id" in region, `region missing id`);
      assert.ok("scope" in region, `region "${region.id}" missing scope`);
      assert.ok("purpose" in region, `region "${region.id}" missing purpose`);
      assert.equal(typeof region.id, "string");
      assert.equal(typeof region.scope, "string");
      assert.equal(typeof region.purpose, "string");
    }
  });

  it("all IDs are unique", () => {
    const ids = FOCUS_REGIONS.map(r => r.id);
    assert.equal(new Set(ids).size, ids.length, "duplicate region IDs found");
  });

  it("all scopes are valid", () => {
    const validScopes = new Set(["global", "view", "panel", "input", "overlay"]);
    for (const region of FOCUS_REGIONS) {
      assert.ok(validScopes.has(region.scope), `invalid scope "${region.scope}" for region "${region.id}"`);
    }
  });
});

// ═══ 2. FOCUS_CYCLES ═══════════════════════════════════════════════════

describe("FOCUS_CYCLES", () => {
  it("overview cycle has 3 regions", () => {
    assert.equal(FOCUS_CYCLES.overview.length, 3);
  });

  it("review cycle has 2 regions", () => {
    assert.equal(FOCUS_CYCLES.review.length, 2);
  });

  it("chat cycle has 5 regions", () => {
    assert.equal(FOCUS_CYCLES.chat.length, 5);
  });

  it("operations cycle has 2 regions", () => {
    assert.equal(FOCUS_CYCLES.operations.length, 2);
  });

  it("all cycle regions exist in FOCUS_REGIONS", () => {
    const regionIds = new Set(FOCUS_REGIONS.map(r => r.id));
    for (const [view, cycle] of Object.entries(FOCUS_CYCLES)) {
      for (const regionId of cycle) {
        assert.ok(regionIds.has(regionId), `cycle region "${regionId}" in view "${view}" not found in FOCUS_REGIONS`);
      }
    }
  });
});

// ═══ 3. nextFocusInCycle / prevFocusInCycle ═════════════════════════════

describe("nextFocusInCycle", () => {
  it("chat: sessions → transcript → composer → git.commits → git.files → sessions (wraps)", () => {
    const expected = [
      "chat.sessions",
      "chat.transcript",
      "chat.composer",
      "chat.git.commits",
      "chat.git.files",
    ];
    let current = expected[0];
    for (let i = 1; i < expected.length; i++) {
      current = nextFocusInCycle("chat", current);
      assert.equal(current, expected[i], `step ${i}: expected "${expected[i]}", got "${current}"`);
    }
    // Wrap around
    current = nextFocusInCycle("chat", current);
    assert.equal(current, expected[0], "should wrap back to first region");
  });

  it("null current returns first in cycle", () => {
    assert.equal(nextFocusInCycle("chat", null), "chat.sessions");
  });

  it("unknown region returns first in cycle", () => {
    assert.equal(nextFocusInCycle("chat", "nonexistent.region"), "chat.sessions");
  });

  it("unknown view with null current returns empty string", () => {
    assert.equal(nextFocusInCycle("nonexistent", null), "");
  });

  it("unknown view with some current returns that current", () => {
    assert.equal(nextFocusInCycle("nonexistent", "some.region"), "some.region");
  });
});

describe("prevFocusInCycle", () => {
  it("chat: sessions wraps back to git.files", () => {
    const result = prevFocusInCycle("chat", "chat.sessions");
    assert.equal(result, "chat.git.files");
  });

  it("chat: transcript → sessions", () => {
    const result = prevFocusInCycle("chat", "chat.transcript");
    assert.equal(result, "chat.sessions");
  });

  it("null current returns first in cycle", () => {
    assert.equal(prevFocusInCycle("chat", null), "chat.sessions");
  });

  it("unknown region returns first in cycle", () => {
    assert.equal(prevFocusInCycle("overview", "nonexistent.region"), "overview.summary");
  });
});

// ═══ 4. regionsForView ═════════════════════════════════════════════════

describe("regionsForView", () => {
  it("overview returns 3 regions", () => {
    const regions = regionsForView("overview");
    assert.equal(regions.length, 3);
  });

  it("chat returns 5 regions", () => {
    const regions = regionsForView("chat");
    assert.equal(regions.length, 5);
  });

  it("unknown view returns empty", () => {
    const regions = regionsForView("nonexistent");
    assert.equal(regions.length, 0);
  });
});

// ═══ 5. adjustedChatCycle ══════════════════════════════════════════════

describe("adjustedChatCycle", () => {
  it("width >= 100 returns full 5-region cycle", () => {
    const cycle = adjustedChatCycle(100);
    assert.equal(cycle.length, 5);
    assert.ok(cycle.includes("chat.git.commits"));
    assert.ok(cycle.includes("chat.git.files"));
  });

  it("width >= 100 returns a copy (not the same array)", () => {
    const cycle = adjustedChatCycle(120);
    assert.notStrictEqual(cycle, FOCUS_CYCLES.chat);
  });

  it("width < 100 returns 3-region cycle (no git.*)", () => {
    const cycle = adjustedChatCycle(99);
    assert.equal(cycle.length, 3);
    assert.ok(!cycle.some(r => r.startsWith("chat.git.")), "should not include chat.git.* regions");
    assert.ok(cycle.includes("chat.sessions"));
    assert.ok(cycle.includes("chat.transcript"));
    assert.ok(cycle.includes("chat.composer"));
  });
});

// ═══ 6. GLOBAL_SHORTCUTS ══════════════════════════════════════════════

describe("GLOBAL_SHORTCUTS", () => {
  it("has exactly 9 bindings", () => {
    assert.equal(GLOBAL_SHORTCUTS.length, 9);
  });

  it("contains expected keys", () => {
    const keys = GLOBAL_SHORTCUTS.map(s => s.key);
    const expected = ["1", "2", "3", "4", "tab", "shift+tab", "?", ":", "q"];
    for (const k of expected) {
      assert.ok(keys.includes(k), `missing key "${k}"`);
    }
  });

  it("all bindings have required fields", () => {
    for (const binding of GLOBAL_SHORTCUTS) {
      assert.equal(typeof binding.key, "string");
      assert.equal(typeof binding.description, "string");
      assert.equal(typeof binding.action, "string");
      assert.equal(binding.scope, "global");
    }
  });
});

// ═══ 7. CHAT_SHORTCUTS ════════════════════════════════════════════════

describe("CHAT_SHORTCUTS", () => {
  it("has exactly 18 bindings", () => {
    assert.equal(CHAT_SHORTCUTS.length, 18);
  });

  it("contains expected keys", () => {
    const keys = CHAT_SHORTCUTS.map(s => s.key);
    const expected = ["left", "right", "up", "down", "enter", "i", "escape", "v", "y", "p", "g", "f", "s", "t"];
    for (const k of expected) {
      assert.ok(keys.includes(k), `missing key "${k}"`);
    }
  });

  it("all bindings have valid scope (panel or input)", () => {
    const validScopes = new Set(["panel", "input"]);
    for (const binding of CHAT_SHORTCUTS) {
      assert.ok(validScopes.has(binding.scope), `invalid scope "${binding.scope}" for key "${binding.key}"`);
    }
  });
});

// ═══ 8. getEffectiveShortcuts ══════════════════════════════════════════

describe("getEffectiveShortcuts", () => {
  it("overview + no overlay returns globals only", () => {
    const shortcuts = getEffectiveShortcuts("overview", null, "none");
    assert.equal(shortcuts.length, GLOBAL_SHORTCUTS.length);
    // Should not contain chat-specific shortcuts
    const keys = shortcuts.map(s => s.key);
    assert.ok(!keys.includes("left"), "should not include chat shortcut 'left'");
  });

  it("chat + no overlay returns globals + chat shortcuts", () => {
    const shortcuts = getEffectiveShortcuts("chat", null, "none");
    assert.equal(shortcuts.length, GLOBAL_SHORTCUTS.length + CHAT_SHORTCUTS.length);
  });

  it("any view + help overlay returns escape + globals (minus ?)", () => {
    const shortcuts = getEffectiveShortcuts("overview", null, "help");
    const keys = shortcuts.map(s => s.key);
    assert.ok(keys.includes("escape"), "should include escape");
    assert.ok(!keys.includes("?"), "should not include ? (help toggle)");
    // escape + (9 globals - 1 for ?) = 9
    assert.equal(shortcuts.length, 9);
  });

  it("command overlay also returns escape + globals (minus ?)", () => {
    const shortcuts = getEffectiveShortcuts("chat", "chat.sessions", "command");
    const keys = shortcuts.map(s => s.key);
    assert.ok(keys.includes("escape"), "should include escape");
    assert.ok(!keys.includes("?"), "should not include ?");
  });

  it("overlay mode does not include chat-specific shortcuts", () => {
    const shortcuts = getEffectiveShortcuts("chat", "chat.sessions", "help");
    const keys = shortcuts.map(s => s.key);
    assert.ok(!keys.includes("left"), "should not include chat shortcut in overlay mode");
    assert.ok(!keys.includes("g"), "should not include chat shortcut 'g' in overlay mode");
  });
});

// ═══ 9. findKeyCollisions ═════════════════════════════════════════════

describe("findKeyCollisions", () => {
  it("no same-scope collisions exist", () => {
    const collisions = findKeyCollisions();
    assert.equal(collisions.length, 0, `found collisions: ${JSON.stringify(collisions.map(c => c.key))}`);
  });
});

// ═══ 10. getFooterHints ═══════════════════════════════════════════════

describe("getFooterHints", () => {
  it("returns maxHints or fewer shortcuts", () => {
    const hints = getFooterHints("overview", null, "none", 5);
    assert.ok(hints.length <= 5, `got ${hints.length} hints, expected <= 5`);
    assert.ok(hints.length > 0, "should return at least one hint");
  });

  it("default maxHints is 5", () => {
    const hints = getFooterHints("overview", null, "none");
    assert.ok(hints.length <= 5, `got ${hints.length} hints, expected <= 5`);
  });

  it("respects maxHints parameter", () => {
    const hints3 = getFooterHints("overview", null, "none", 3);
    assert.ok(hints3.length <= 3);

    const hints1 = getFooterHints("overview", null, "none", 1);
    assert.ok(hints1.length <= 1);
  });

  it("each hint has key and description", () => {
    const hints = getFooterHints("chat", null, "none", 5);
    for (const hint of hints) {
      assert.equal(typeof hint.key, "string");
      assert.equal(typeof hint.description, "string");
    }
  });
});
