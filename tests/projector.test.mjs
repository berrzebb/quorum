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

// ═══ 2. Tag Conversion ════════════════════════════════════════════════

describe("MarkdownProjector tag conversion", () => {
  let store, dir, projector;

  beforeEach(() => {
    ({ store, dir } = createTempStore());
    projector = new MarkdownProjector(store.getDb(), TEST_CONFIG);
  });

  it("converts states to tags", () => {
    assert.equal(projector.stateToTag("review_needed"), "[REVIEW_NEEDED]");
    assert.equal(projector.stateToTag("approved"), "[APPROVED]");
    assert.equal(projector.stateToTag("changes_requested"), "[CHANGES_REQUESTED]");
    assert.equal(projector.stateToTag("infra_failure"), "[INFRA_FAILURE]");
  });

  it("converts tags to states", () => {
    assert.equal(projector.tagToState("[REVIEW_NEEDED]"), "review_needed");
    assert.equal(projector.tagToState("[APPROVED]"), "approved");
    assert.equal(projector.tagToState("[CHANGES_REQUESTED]"), "changes_requested");
    assert.equal(projector.tagToState("[INFRA_FAILURE]"), "infra_failure");
  });

  it("cleanup", () => { store.close(); cleanup(dir); });
});

// ═══ 3. State Summary ════════════════════════════════════════════════

describe("MarkdownProjector generateStateSummary", () => {
  let store, dir, projector;

  beforeEach(() => {
    ({ store, dir } = createTempStore());
    projector = new MarkdownProjector(store.getDb(), TEST_CONFIG);
  });

  it("returns message for empty state", () => {
    const summary = projector.generateStateSummary();
    assert.ok(summary.includes("No audit items"));
  });

  it("generates grouped summary by state", () => {
    store.commitTransaction([], [
      { entityType: "audit_item", entityId: "TN-1", toState: "approved", source: "codex", metadata: { label: "Feature A" } },
      { entityType: "audit_item", entityId: "TN-2", toState: "review_needed", source: "claude-code", metadata: { label: "Feature B" } },
      { entityType: "audit_item", entityId: "TN-3", toState: "approved", source: "codex", metadata: { label: "Feature C" } },
    ], []);

    const summary = projector.generateStateSummary();
    assert.ok(summary.includes("[APPROVED] (2)"));
    assert.ok(summary.includes("[REVIEW_NEEDED] (1)"));
    assert.ok(summary.includes("Feature A"));
    assert.ok(summary.includes("Feature B"));
  });

  it("cleanup", () => { store.close(); cleanup(dir); });
});

// ═══ 4. Staleness Check ═══════════════════════════════════════════════

describe("MarkdownProjector checkStaleness", () => {
  let store, dir, projector;

  beforeEach(() => {
    ({ store, dir } = createTempStore());
    projector = new MarkdownProjector(store.getDb(), TEST_CONFIG);
  });

  it("returns null for nonexistent file", () => {
    const diff = projector.checkStaleness(resolve(dir, "nonexistent.md"));
    assert.equal(diff, null);
  });

  it("returns null when no transitions tracked", () => {
    const filePath = resolve(dir, "test.md");
    writeFileSync(filePath, "# Some content\n");
    const diff = projector.checkStaleness(filePath);
    assert.equal(diff, null);
  });

  it("detects stale file when tag mismatches", () => {
    const filePath = resolve(dir, "claude.md");
    writeFileSync(filePath, "- [REVIEW_NEEDED] TN-1 Feature A\n");

    // SQLite says TN-1 is approved
    store.commitTransaction([], [
      { entityType: "audit_item", entityId: "TN-1", toState: "approved", source: "codex", metadata: { label: "Feature A" } },
    ], []);

    const diff = projector.checkStaleness(filePath);
    assert.ok(diff !== null);
    assert.equal(diff.stale, true);
    assert.ok(diff.projected.includes("[APPROVED]"));
  });

  it("returns null when file matches SQLite state", () => {
    const filePath = resolve(dir, "claude.md");
    writeFileSync(filePath, "- [APPROVED] TN-1 Feature A\n");

    store.commitTransaction([], [
      { entityType: "audit_item", entityId: "TN-1", toState: "approved", source: "codex" },
    ], []);

    const diff = projector.checkStaleness(filePath);
    assert.equal(diff, null);
  });

  it("cleanup", () => { store.close(); cleanup(dir); });
});

// ═══ 5. Entity History ════════════════════════════════════════════════

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
