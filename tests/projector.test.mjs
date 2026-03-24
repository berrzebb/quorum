#!/usr/bin/env node
/**
 * MarkdownProjector Tests
 *
 * Run: node --test tests/projector.test.mjs
 */

import { strict as assert } from "node:assert";
import { describe, it, beforeEach } from "node:test";
import { resolve } from "node:path";
import { writeFileSync, readFileSync } from "node:fs";

import { createTempStore, cleanup } from "./helpers.mjs";

const { MarkdownProjector } = await import("../dist/bus/projector.js");

const TEST_CONFIG = {
  triggerTag: "[REVIEW_NEEDED]",
  agreeTag: "[APPROVED]",
  pendingTag: "[CHANGES_REQUESTED]",
};

// ═══ 1. ItemState Queries ═════════════════════════════════════════════

describe("MarkdownProjector queryItemStates", () => {
  let store, dir, projector;

  beforeEach(() => {
    ({ store, dir } = createTempStore());
    projector = new MarkdownProjector(store.getDb(), TEST_CONFIG);
  });

  it("returns empty for no transitions", () => {
    const items = projector.queryItemStates();
    assert.equal(items.length, 0);
  });

  it("returns current state for each entity", () => {
    store.commitTransaction([], [
      { entityType: "audit_item", entityId: "TN-1", toState: "review_needed", source: "claude-code" },
      { entityType: "audit_item", entityId: "TN-2", toState: "approved", source: "codex" },
    ], []);

    const items = projector.queryItemStates();
    assert.equal(items.length, 2);

    const tn1 = items.find(i => i.entityId === "TN-1");
    assert.equal(tn1.currentState, "review_needed");

    const tn2 = items.find(i => i.entityId === "TN-2");
    assert.equal(tn2.currentState, "approved");
  });

  it("returns latest state after progression", () => {
    store.commitTransaction([], [
      { entityType: "audit_item", entityId: "TN-1", toState: "review_needed", source: "claude-code" },
    ], []);
    store.commitTransaction([], [
      { entityType: "audit_item", entityId: "TN-1", fromState: "review_needed", toState: "approved", source: "codex" },
    ], []);

    const items = projector.queryItemStates();
    assert.equal(items.length, 1);
    assert.equal(items[0].currentState, "approved");
  });

  it("cleanup", () => { store.close(); cleanup(dir); });
});

// ═══ 2. Entity History ════════════════════════════════════════════════

describe("MarkdownProjector entityHistory", () => {
  let store, dir, projector;

  beforeEach(() => {
    ({ store, dir } = createTempStore());
    projector = new MarkdownProjector(store.getDb(), TEST_CONFIG);
  });

  it("returns empty for unknown entity", () => {
    const history = projector.entityHistory("UNKNOWN");
    assert.equal(history.length, 0);
  });

  it("returns full transition history", () => {
    store.commitTransaction([], [
      { entityType: "audit_item", entityId: "TN-1", toState: "review_needed", source: "claude-code" },
    ], []);
    store.commitTransaction([], [
      { entityType: "audit_item", entityId: "TN-1", fromState: "review_needed", toState: "changes_requested", source: "codex" },
    ], []);
    store.commitTransaction([], [
      { entityType: "audit_item", entityId: "TN-1", fromState: "changes_requested", toState: "approved", source: "codex" },
    ], []);

    const history = projector.entityHistory("TN-1");
    assert.equal(history.length, 3);
    assert.equal(history[0].toState, "review_needed");
    assert.equal(history[1].toState, "changes_requested");
    assert.equal(history[2].toState, "approved");
  });

  it("cleanup", () => { store.close(); cleanup(dir); });
});
