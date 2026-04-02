#!/usr/bin/env node
/**
 * GRAPH-5: Changeset History Tests
 *
 * Tests graph-history.ts:
 * - createChangeset, getChangeset
 * - recordEntityChange, getEntityHistory
 * - recordRelationChange, getRelationHistory
 * - getChangesetChanges (grouped query)
 * - Event publication (graph.changeset)
 *
 * Run: node --test tests/graph-history.test.mjs
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

const { EventStore } = await import("../dist/platform/bus/store.js");
const {
  createChangeset, getChangeset,
  recordEntityChange, getEntityHistory,
  recordRelationChange, getRelationHistory,
  getChangesetChanges,
} = await import("../dist/platform/bus/graph-history.js");

let store;
let db;

beforeEach(() => {
  store = new EventStore(":memory:");
  db = store.db;
});

afterEach(() => { store.close(); });

// ═══ 1. createChangeset ═══════════════════════════════════════════════

describe("createChangeset", () => {
  it("creates changeset with defaults", () => {
    const cs = createChangeset(db);
    assert.ok(cs.id);
    assert.equal(cs.source, "manual");
    assert.equal(cs.description, undefined);
    assert.ok(cs.createdAt > 0);
  });

  it("creates changeset with custom source and description", () => {
    const cs = createChangeset(db, { source: "bootstrap", description: "Import PRD entities" });
    assert.equal(cs.source, "bootstrap");
    assert.equal(cs.description, "Import PRD entities");
  });

  it("publishes graph.changeset event", () => {
    const cs = createChangeset(db, { source: "test" });
    const events = db.prepare("SELECT * FROM events WHERE event_type = 'graph.changeset'").all();
    assert.equal(events.length, 1);
    const payload = JSON.parse(events[0].payload);
    assert.equal(payload.changesetId, cs.id);
  });
});

// ═══ 2. getChangeset ══════════════════════════════════════════════════

describe("getChangeset", () => {
  it("returns changeset by id", () => {
    const cs = createChangeset(db);
    const fetched = getChangeset(db, cs.id);
    assert.ok(fetched);
    assert.equal(fetched.id, cs.id);
    assert.equal(fetched.source, cs.source);
  });

  it("returns null for non-existent id", () => {
    assert.equal(getChangeset(db, "nonexistent"), null);
  });
});

// ═══ 3. recordEntityChange ════════════════════════════════════════════

describe("recordEntityChange", () => {
  it("records create action", () => {
    const cs = createChangeset(db);
    const change = recordEntityChange(db, cs.id, "FR-01", "create", null, { type: "requirement", title: "Feature 1" });
    assert.ok(change.id);
    assert.equal(change.changesetId, cs.id);
    assert.equal(change.entityId, "FR-01");
    assert.equal(change.action, "create");
    assert.equal(change.beforeData, null);
    assert.deepEqual(change.afterData, { type: "requirement", title: "Feature 1" });
  });

  it("records update action with before/after", () => {
    const cs = createChangeset(db);
    const change = recordEntityChange(db, cs.id, "FR-01", "update",
      { status: "draft" },
      { status: "active" },
    );
    assert.equal(change.action, "update");
    assert.deepEqual(change.beforeData, { status: "draft" });
    assert.deepEqual(change.afterData, { status: "active" });
  });

  it("records delete action", () => {
    const cs = createChangeset(db);
    const change = recordEntityChange(db, cs.id, "FR-01", "delete",
      { type: "requirement", title: "Old" },
      null,
    );
    assert.equal(change.action, "delete");
    assert.ok(change.beforeData);
    assert.equal(change.afterData, null);
  });
});

// ═══ 4. recordRelationChange ══════════════════════════════════════════

describe("recordRelationChange", () => {
  it("records relation create", () => {
    const cs = createChangeset(db);
    const change = recordRelationChange(db, cs.id, "rel-001", "create", null,
      { fromId: "FR-01", toId: "FR-02", type: "depends_on" },
    );
    assert.ok(change.id);
    assert.equal(change.relationId, "rel-001");
    assert.equal(change.action, "create");
  });

  it("records relation delete", () => {
    const cs = createChangeset(db);
    const change = recordRelationChange(db, cs.id, "rel-001", "delete",
      { fromId: "FR-01", toId: "FR-02", type: "depends_on" },
      null,
    );
    assert.equal(change.action, "delete");
    assert.equal(change.afterData, null);
  });
});

// ═══ 5. getEntityHistory ══════════════════════════════════════════════

describe("getEntityHistory", () => {
  it("returns chronological history for an entity", () => {
    const cs1 = createChangeset(db, { description: "create" });
    recordEntityChange(db, cs1.id, "FR-01", "create", null, { status: "draft" });

    const cs2 = createChangeset(db, { description: "update" });
    recordEntityChange(db, cs2.id, "FR-01", "update", { status: "draft" }, { status: "active" });

    const history = getEntityHistory(db, "FR-01");
    assert.equal(history.length, 2);
    assert.equal(history[0].action, "create");
    assert.equal(history[1].action, "update");
  });

  it("returns empty array for unknown entity", () => {
    assert.deepEqual(getEntityHistory(db, "NOPE"), []);
  });
});

// ═══ 6. getRelationHistory ════════════════════════════════════════════

describe("getRelationHistory", () => {
  it("returns history for a relation", () => {
    const cs = createChangeset(db);
    recordRelationChange(db, cs.id, "rel-001", "create", null, { type: "depends_on" });

    const history = getRelationHistory(db, "rel-001");
    assert.equal(history.length, 1);
    assert.equal(history[0].action, "create");
  });
});

// ═══ 7. getChangesetChanges ═══════════════════════════════════════════

describe("getChangesetChanges", () => {
  it("returns all changes in a changeset", () => {
    const cs = createChangeset(db);
    recordEntityChange(db, cs.id, "FR-01", "create", null, { title: "A" });
    recordEntityChange(db, cs.id, "FR-02", "create", null, { title: "B" });
    recordRelationChange(db, cs.id, "rel-001", "create", null, { type: "depends_on" });

    const changes = getChangesetChanges(db, cs.id);
    assert.equal(changes.entityChanges.length, 2);
    assert.equal(changes.relationChanges.length, 1);
  });

  it("returns empty for non-existent changeset", () => {
    const changes = getChangesetChanges(db, "nonexistent");
    assert.equal(changes.entityChanges.length, 0);
    assert.equal(changes.relationChanges.length, 0);
  });
});

// ═══ 8. Multiple changesets per entity ════════════════════════════════

describe("multiple changesets", () => {
  it("tracks full lifecycle of an entity", () => {
    const cs1 = createChangeset(db, { source: "bootstrap" });
    recordEntityChange(db, cs1.id, "FR-01", "create", null, { status: "draft" });

    const cs2 = createChangeset(db, { source: "user" });
    recordEntityChange(db, cs2.id, "FR-01", "update", { status: "draft" }, { status: "active" });

    const cs3 = createChangeset(db, { source: "deprecation" });
    recordEntityChange(db, cs3.id, "FR-01", "delete", { status: "active" }, null);

    const history = getEntityHistory(db, "FR-01");
    assert.equal(history.length, 3);
    assert.deepEqual(history.map(h => h.action), ["create", "update", "delete"]);
  });
});
