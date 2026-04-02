#!/usr/bin/env node
/**
 * GRAPH-1: Entity Schema + CRUD Tests
 *
 * Tests entity CRUD operations on the SQLite entities table:
 * - addEntity with 12 types and 5 statuses
 * - getEntity, listEntities, updateEntity, deprecateEntity
 * - Validation: invalid type/status, duplicate id
 *
 * Run: node --test tests/graph-schema.test.mjs
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

const { EventStore } = await import("../dist/platform/bus/store.js");
const {
  addEntity, getEntity, listEntities, updateEntity, deprecateEntity,
} = await import("../dist/platform/bus/graph-schema.js");

let store;
let db;

beforeEach(() => {
  store = new EventStore(":memory:");
  db = store.db;
});

afterEach(() => {
  store.close();
});

// ═══ 1. addEntity ═══════════════════════════════════════════════════════

describe("addEntity", () => {
  it("creates entity with minimal fields", () => {
    const e = addEntity(db, { id: "FR-01", type: "requirement", title: "Test feature" });
    assert.equal(e.id, "FR-01");
    assert.equal(e.type, "requirement");
    assert.equal(e.title, "Test feature");
    assert.equal(e.status, "draft");
    assert.deepEqual(e.metadata, {});
    assert.ok(e.createdAt > 0);
    assert.ok(e.updatedAt > 0);
  });

  it("creates entity with all fields", () => {
    const e = addEntity(db, {
      id: "DEC-01",
      type: "decision",
      title: "Use SQLite",
      description: "Store everything in SQLite",
      status: "active",
      metadata: { priority: "P0", track: "GRAPH" },
    });
    assert.equal(e.status, "active");
    assert.equal(e.description, "Store everything in SQLite");
    assert.deepEqual(e.metadata, { priority: "P0", track: "GRAPH" });
  });

  it("supports all 12 entity types", () => {
    const types = [
      "requirement", "decision", "interface", "state",
      "crosscut", "question", "assumption", "criterion",
      "risk", "test", "plan", "phase",
    ];
    for (const type of types) {
      const e = addEntity(db, { id: `${type}-1`, type, title: `${type} entity` });
      assert.equal(e.type, type);
    }
  });

  it("supports all 5 statuses", () => {
    const statuses = ["draft", "active", "deprecated", "resolved", "deleted"];
    for (let i = 0; i < statuses.length; i++) {
      const e = addEntity(db, { id: `S-${i}`, type: "requirement", title: `status ${statuses[i]}`, status: statuses[i] });
      assert.equal(e.status, statuses[i]);
    }
  });

  it("rejects invalid entity type", () => {
    assert.throws(
      () => addEntity(db, { id: "X-1", type: "invalid", title: "bad" }),
      /Invalid entity type/,
    );
  });

  it("rejects invalid status", () => {
    assert.throws(
      () => addEntity(db, { id: "X-2", type: "requirement", title: "bad", status: "unknown" }),
      /Invalid entity status/,
    );
  });

  it("rejects duplicate id", () => {
    addEntity(db, { id: "DUP-1", type: "requirement", title: "first" });
    assert.throws(
      () => addEntity(db, { id: "DUP-1", type: "decision", title: "second" }),
      /already exists/,
    );
  });
});

// ═══ 2. getEntity ═══════════════════════════════════════════════════════

describe("getEntity", () => {
  it("returns entity by id", () => {
    addEntity(db, { id: "FR-10", type: "requirement", title: "Get test" });
    const e = getEntity(db, "FR-10");
    assert.ok(e);
    assert.equal(e.id, "FR-10");
  });

  it("returns null for non-existent id", () => {
    assert.equal(getEntity(db, "NOPE"), null);
  });
});

// ═══ 3. listEntities ════════════════════════════════════════════════════

describe("listEntities", () => {
  beforeEach(() => {
    addEntity(db, { id: "R-1", type: "requirement", title: "R1", status: "active" });
    addEntity(db, { id: "R-2", type: "requirement", title: "R2", status: "draft" });
    addEntity(db, { id: "D-1", type: "decision", title: "D1", status: "active" });
  });

  it("returns all entities without filter", () => {
    const all = listEntities(db);
    assert.equal(all.length, 3);
  });

  it("filters by type", () => {
    const reqs = listEntities(db, { type: "requirement" });
    assert.equal(reqs.length, 2);
  });

  it("filters by status", () => {
    const active = listEntities(db, { status: "active" });
    assert.equal(active.length, 2);
  });

  it("filters by type + status", () => {
    const activeReqs = listEntities(db, { type: "requirement", status: "active" });
    assert.equal(activeReqs.length, 1);
    assert.equal(activeReqs[0].id, "R-1");
  });
});

// ═══ 4. updateEntity ════════════════════════════════════════════════════

describe("updateEntity", () => {
  it("updates title and status", () => {
    addEntity(db, { id: "U-1", type: "requirement", title: "Old" });
    const updated = updateEntity(db, "U-1", { title: "New", status: "active" });
    assert.equal(updated.title, "New");
    assert.equal(updated.status, "active");
    assert.ok(updated.updatedAt >= updated.createdAt);
  });

  it("throws for non-existent entity", () => {
    assert.throws(
      () => updateEntity(db, "NOPE", { title: "x" }),
      /not found/,
    );
  });

  it("rejects invalid status on update", () => {
    addEntity(db, { id: "U-2", type: "requirement", title: "x" });
    assert.throws(
      () => updateEntity(db, "U-2", { status: "bogus" }),
      /Invalid entity status/,
    );
  });
});

// ═══ 5. deprecateEntity ═════════════════════════════════════════════════

describe("deprecateEntity", () => {
  it("sets status to deprecated", () => {
    addEntity(db, { id: "DEP-1", type: "decision", title: "Old decision", status: "active" });
    const result = deprecateEntity(db, "DEP-1");
    assert.equal(result.status, "deprecated");

    const fetched = getEntity(db, "DEP-1");
    assert.equal(fetched.status, "deprecated");
  });
});
