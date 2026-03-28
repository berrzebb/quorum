import { describe, it } from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// Contract data structures — these define the TARGET daemon shell architecture.
// Tests validate completeness and consistency of the contract itself.
// ---------------------------------------------------------------------------

/** @type {readonly ["overview", "review", "chat", "operations"]} */
const DAEMON_VIEWS = ["overview", "review", "chat", "operations"];

/** @type {Record<string, string>} view -> default focus region */
const VIEW_DEFAULT_FOCUS = {
  overview: "overview.summary",
  review: "review.findings",
  chat: "chat.sessions",
  operations: "operations.providers",
};

/** @type {Array<{id: string, scope: string, purpose: string}>} */
const REGIONS = [
  { id: "header.tabs", scope: "global", purpose: "view tab navigation" },
  { id: "footer.hints", scope: "global", purpose: "current scope shortcut hints" },
  { id: "overlay.help", scope: "overlay", purpose: "shortcut/help overlay" },
  { id: "overlay.command", scope: "overlay", purpose: "command palette" },
  { id: "overview.summary", scope: "view", purpose: "overview key cards" },
  { id: "overview.gates", scope: "panel", purpose: "gate summary" },
  { id: "overview.tracks", scope: "panel", purpose: "track progress" },
  { id: "review.findings", scope: "panel", purpose: "finding list" },
  { id: "review.thread", scope: "panel", purpose: "thread inspector" },
  { id: "chat.sessions", scope: "panel", purpose: "mux session list" },
  { id: "chat.transcript", scope: "panel", purpose: "transcript viewport" },
  { id: "chat.composer", scope: "input", purpose: "composer" },
  { id: "chat.git.commits", scope: "panel", purpose: "commit graph" },
  { id: "chat.git.files", scope: "panel", purpose: "changed files" },
  { id: "operations.providers", scope: "panel", purpose: "provider/runtime status" },
  { id: "operations.worktrees", scope: "panel", purpose: "git/worktree/lock status" },
];

const CHAT_FOCUS_CYCLE = [
  "chat.sessions",
  "chat.transcript",
  "chat.composer",
  "chat.git.commits",
  "chat.git.files",
];

/** @type {Array<{key: string, action: string, scope: "global"}>} */
const GLOBAL_SHORTCUTS = [
  { key: "1", action: "overview view", scope: "global" },
  { key: "2", action: "review view", scope: "global" },
  { key: "3", action: "chat view", scope: "global" },
  { key: "4", action: "operations view", scope: "global" },
  { key: "tab", action: "next focus region", scope: "global" },
  { key: "shift+tab", action: "previous focus region", scope: "global" },
  { key: "?", action: "help overlay toggle", scope: "global" },
  { key: ":", action: "command overlay open", scope: "global" },
  { key: "q", action: "quit daemon", scope: "global" },
];

/** @type {Array<{key: string, action: string, scope: string}>} */
const CHAT_SHORTCUTS = [
  { key: "left/right", action: "session change when chat.sessions focused", scope: "panel" },
  { key: "up/down", action: "line scroll in active pane", scope: "panel" },
  { key: "pgup/pgdn", action: "page scroll in active pane", scope: "panel" },
  { key: "home/end", action: "top/bottom jump in active pane", scope: "panel" },
  { key: "enter", action: "composer focus or submit", scope: "panel/input" },
  { key: "i", action: "composer focus", scope: "panel" },
  { key: "esc", action: "leave composer / clear selection mode", scope: "input" },
  { key: "v", action: "transcript selection mode toggle", scope: "panel" },
  { key: "y", action: "copy selected transcript text", scope: "panel" },
  { key: "p", action: "paste clipboard into composer", scope: "input" },
  { key: "g", action: "focus commit graph", scope: "panel" },
  { key: "f", action: "focus changed files", scope: "panel" },
  { key: "s", action: "focus session list", scope: "panel" },
  { key: "t", action: "focus transcript", scope: "panel" },
];

const OVERLAY_VALUES = ["none", "help", "command"];
const DENSITY_VALUES = ["comfortable", "compact"];

// ---------------------------------------------------------------------------
// 1. View registry contract
// ---------------------------------------------------------------------------

describe("View registry contract", () => {
  it("DaemonView includes all 4 views", () => {
    assert.deepStrictEqual(
      [...DAEMON_VIEWS].sort(),
      ["chat", "operations", "overview", "review"],
    );
  });

  it("view count is exactly 4", () => {
    assert.equal(DAEMON_VIEWS.length, 4);
  });

  it("each view has a default focus region", () => {
    for (const view of DAEMON_VIEWS) {
      assert.ok(
        VIEW_DEFAULT_FOCUS[view],
        `view "${view}" missing default focus`,
      );
    }
  });

  it("default focus regions reference valid region IDs", () => {
    const regionIds = new Set(REGIONS.map((r) => r.id));
    for (const [view, regionId] of Object.entries(VIEW_DEFAULT_FOCUS)) {
      assert.ok(
        regionIds.has(regionId),
        `view "${view}" default focus "${regionId}" is not a valid region`,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Region contract
// ---------------------------------------------------------------------------

describe("Region contract", () => {
  it("16 regions exist in the contract", () => {
    assert.equal(REGIONS.length, 16);
  });

  it("each region has id, scope, and purpose", () => {
    for (const region of REGIONS) {
      assert.ok(region.id, `region missing id`);
      assert.ok(region.scope, `region "${region.id}" missing scope`);
      assert.ok(region.purpose, `region "${region.id}" missing purpose`);
    }
  });

  it("region IDs are unique", () => {
    const ids = REGIONS.map((r) => r.id);
    assert.equal(new Set(ids).size, ids.length, "duplicate region IDs found");
  });

  it("region scopes are valid", () => {
    const validScopes = new Set(["global", "overlay", "view", "panel", "input"]);
    for (const region of REGIONS) {
      assert.ok(
        validScopes.has(region.scope),
        `region "${region.id}" has invalid scope "${region.scope}"`,
      );
    }
  });

  it("chat focus cycle covers all chat panel/input regions", () => {
    const chatRegions = REGIONS.filter(
      (r) => r.id.startsWith("chat.") && (r.scope === "panel" || r.scope === "input"),
    ).map((r) => r.id);
    assert.deepStrictEqual(
      [...CHAT_FOCUS_CYCLE].sort(),
      [...chatRegions].sort(),
      "chat focus cycle must match chat panel/input regions",
    );
  });

  it("chat focus cycle is sessions -> transcript -> composer -> git.commits -> git.files -> sessions", () => {
    assert.deepStrictEqual(CHAT_FOCUS_CYCLE, [
      "chat.sessions",
      "chat.transcript",
      "chat.composer",
      "chat.git.commits",
      "chat.git.files",
    ]);
    // Verify wrap-around: after last element, next is first
    const nextAfterLast = CHAT_FOCUS_CYCLE[0];
    assert.equal(nextAfterLast, "chat.sessions");
  });
});

// ---------------------------------------------------------------------------
// 3. Shortcut contract
// ---------------------------------------------------------------------------

describe("Shortcut contract", () => {
  it("global shortcuts include view switch keys 1-4", () => {
    const keys = GLOBAL_SHORTCUTS.map((s) => s.key);
    assert.ok(keys.includes("1"), "missing key 1");
    assert.ok(keys.includes("2"), "missing key 2");
    assert.ok(keys.includes("3"), "missing key 3");
    assert.ok(keys.includes("4"), "missing key 4");
  });

  it("global shortcuts include tab, shift+tab, ?, :, q", () => {
    const keys = new Set(GLOBAL_SHORTCUTS.map((s) => s.key));
    for (const k of ["tab", "shift+tab", "?", ":", "q"]) {
      assert.ok(keys.has(k), `missing global shortcut "${k}"`);
    }
  });

  it("global shortcut count is 9", () => {
    assert.equal(GLOBAL_SHORTCUTS.length, 9);
  });

  it("chat shortcuts include all expected keys", () => {
    const expected = [
      "left/right", "up/down", "pgup/pgdn", "home/end",
      "enter", "i", "esc", "v", "y", "p", "g", "f", "s", "t",
    ];
    const keys = new Set(CHAT_SHORTCUTS.map((s) => s.key));
    for (const k of expected) {
      assert.ok(keys.has(k), `missing chat shortcut "${k}"`);
    }
  });

  it("chat shortcut count is 14", () => {
    assert.equal(CHAT_SHORTCUTS.length, 14);
  });

  it("all global shortcuts have scope 'global'", () => {
    for (const s of GLOBAL_SHORTCUTS) {
      assert.equal(s.scope, "global", `shortcut "${s.key}" scope is not global`);
    }
  });

  it("no key collision between global and chat single-char shortcuts", () => {
    // Extract single-character keys from both sets for collision check.
    // Multi-key combos like "left/right" or "shift+tab" can't collide with single chars.
    const globalSingleKeys = new Set(
      GLOBAL_SHORTCUTS.map((s) => s.key).filter((k) => k.length === 1),
    );
    const chatSingleKeys = new Set(
      CHAT_SHORTCUTS.map((s) => s.key).filter((k) => k.length === 1),
    );
    for (const k of chatSingleKeys) {
      assert.ok(
        !globalSingleKeys.has(k),
        `key "${k}" collides between global and chat scopes`,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// 4. Shell state contract
// ---------------------------------------------------------------------------

describe("Shell state contract", () => {
  it("DaemonShellState has required fields", () => {
    // Simulate the shape and verify field names
    const requiredFields = ["activeView", "focusedRegion", "overlay", "density"];
    const shape = {
      activeView: "overview",
      focusedRegion: "overview.summary",
      overlay: "none",
      density: "comfortable",
    };
    for (const field of requiredFields) {
      assert.ok(field in shape, `DaemonShellState missing field "${field}"`);
    }
  });

  it("overlay values are none, help, command", () => {
    assert.deepStrictEqual(
      [...OVERLAY_VALUES].sort(),
      ["command", "help", "none"],
    );
  });

  it("density values are comfortable, compact", () => {
    assert.deepStrictEqual(
      [...DENSITY_VALUES].sort(),
      ["comfortable", "compact"],
    );
  });

  it("activeView must be one of the 4 DaemonView values", () => {
    for (const view of DAEMON_VIEWS) {
      assert.ok(
        ["overview", "review", "chat", "operations"].includes(view),
        `"${view}" is not a valid DaemonView`,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// 5. Snapshot contract
// ---------------------------------------------------------------------------

describe("Snapshot contract", () => {
  it("DaemonSnapshot has required top-level fields", () => {
    const requiredFields = ["generatedAt", "overview", "review", "sessions", "operations"];
    const shape = {
      generatedAt: Date.now(),
      overview: {},
      review: {},
      sessions: {},
      operations: {},
    };
    for (const field of requiredFields) {
      assert.ok(field in shape, `DaemonSnapshot missing field "${field}"`);
    }
  });

  it("DaemonSnapshot field count is exactly 5", () => {
    const fields = ["generatedAt", "overview", "review", "sessions", "operations"];
    assert.equal(fields.length, 5);
  });

  it("generatedAt is numeric (epoch timestamp)", () => {
    const snapshot = { generatedAt: Date.now() };
    assert.equal(typeof snapshot.generatedAt, "number");
  });

  it("snapshot sections match view domains", () => {
    // overview -> overview, review -> review, chat -> sessions, operations -> operations
    const snapshotSections = ["overview", "review", "sessions", "operations"];
    const viewToSection = {
      overview: "overview",
      review: "review",
      chat: "sessions",
      operations: "operations",
    };
    for (const view of DAEMON_VIEWS) {
      assert.ok(
        snapshotSections.includes(viewToSection[view]),
        `no snapshot section for view "${view}"`,
      );
    }
  });
});
