#!/usr/bin/env node
/**
 * GRAPH-2: Relation Schema + Allowed Edge Matrix Tests
 *
 * Tests relation CRUD and edge matrix validation:
 * - addRelation with allowed edges
 * - Self-loop rejection
 * - Invalid edge matrix rejection
 * - getRelations, removeRelation, getRelationsByType
 *
 * Run: node --test tests/graph-relations.test.mjs
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

const { EventStore } = await import("../dist/platform/bus/store.js");
const { addEntity } = await import("../dist/platform/bus/graph-schema.js");
const {
  addRelation, getRelations, removeRelation, getRelationsByType, ALLOWED_EDGES,
} = await import("../dist/platform/bus/graph-relations.js");

let store;
let db;

beforeEach(() => {
  store = new EventStore(":memory:");
  db = store.db;
  // Seed entities for relation tests
  addEntity(db, { id: "FR-01", type: "requirement", title: "Feature 1" });
  addEntity(db, { id: "FR-02", type: "requirement", title: "Feature 2" });
  addEntity(db, { id: "DEC-01", type: "decision", title: "Decision 1" });
  addEntity(db, { id: "TST-01", type: "test", title: "Test 1" });
  addEntity(db, { id: "PLN-01", type: "plan", title: "Plan 1" });
  addEntity(db, { id: "CRT-01", type: "criterion", title: "Criterion 1" });
  addEntity(db, { id: "RSK-01", type: "risk", title: "Risk 1" });
  addEntity(db, { id: "CC-01", type: "crosscut", title: "Security" });
  addEntity(db, { id: "QST-01", type: "question", title: "Question 1" });
});

afterEach(() => { store.close(); });

// ═══ 1. addRelation — allowed edges ════════════════════════════════════

describe("addRelation — allowed edges", () => {
  it("creates requirement→requirement depends_on", () => {
    const r = addRelation(db, { fromId: "FR-01", toId: "FR-02", type: "depends_on" });
    assert.ok(r.id);
    assert.equal(r.fromId, "FR-01");
    assert.equal(r.toId, "FR-02");
    assert.equal(r.type, "depends_on");
    assert.equal(r.weight, 1.0);
  });

  it("creates plan→requirement implements", () => {
    const r = addRelation(db, { fromId: "PLN-01", toId: "FR-01", type: "implements" });
    assert.equal(r.type, "implements");
  });

  it("creates test→requirement verifies", () => {
    const r = addRelation(db, { fromId: "TST-01", toId: "FR-01", type: "verifies" });
    assert.equal(r.type, "verifies");
  });

  it("creates crosscut→requirement cross_cuts", () => {
    const r = addRelation(db, { fromId: "CC-01", toId: "FR-01", type: "cross_cuts" });
    assert.equal(r.type, "cross_cuts");
  });

  it("creates decision→risk addresses", () => {
    const r = addRelation(db, { fromId: "DEC-01", toId: "RSK-01", type: "addresses" });
    assert.equal(r.type, "addresses");
  });

  it("supports custom weight", () => {
    const r = addRelation(db, { fromId: "FR-01", toId: "FR-02", type: "depends_on", weight: 0.5 });
    assert.equal(r.weight, 0.5);
  });
});

// ═══ 2. Validation ══════════════════════════════════════════════════════

describe("addRelation — validation", () => {
  it("rejects self-loop", () => {
    assert.throws(
      () => addRelation(db, { fromId: "FR-01", toId: "FR-01", type: "depends_on" }),
      /Self-loop not allowed/,
    );
  });

  it("rejects non-existent source entity", () => {
    assert.throws(
      () => addRelation(db, { fromId: "NOPE", toId: "FR-01", type: "depends_on" }),
      /Source entity not found/,
    );
  });

  it("rejects non-existent target entity", () => {
    assert.throws(
      () => addRelation(db, { fromId: "FR-01", toId: "NOPE", type: "depends_on" }),
      /Target entity not found/,
    );
  });

  it("rejects disallowed edge (requirement→requirement via implements)", () => {
    // implements only allows plan→requirement
    assert.throws(
      () => addRelation(db, { fromId: "FR-01", toId: "FR-02", type: "implements" }),
      /Edge not allowed/,
    );
  });

  it("rejects disallowed edge (test→decision via verifies)", () => {
    // verifies only allows test→requirement or test→interface
    assert.throws(
      () => addRelation(db, { fromId: "TST-01", toId: "DEC-01", type: "verifies" }),
      /Edge not allowed/,
    );
  });

  it("rejects invalid relation type", () => {
    assert.throws(
      () => addRelation(db, { fromId: "FR-01", toId: "FR-02", type: "bogus" }),
      /Invalid relation type/,
    );
  });
});

// ═══ 3. getRelations ════════════════════════════════════════════════════

describe("getRelations", () => {
  beforeEach(() => {
    addRelation(db, { fromId: "FR-01", toId: "FR-02", type: "depends_on" });
    addRelation(db, { fromId: "PLN-01", toId: "FR-01", type: "implements" });
    addRelation(db, { fromId: "TST-01", toId: "FR-01", type: "verifies" });
  });

  it("returns all relations for an entity (both directions)", () => {
    const rels = getRelations(db, "FR-01");
    assert.equal(rels.length, 3); // depends_on(from) + implements(to) + verifies(to)
  });

  it("returns outgoing relations only", () => {
    const rels = getRelations(db, "FR-01", "from");
    assert.equal(rels.length, 1);
    assert.equal(rels[0].type, "depends_on");
  });

  it("returns incoming relations only", () => {
    const rels = getRelations(db, "FR-01", "to");
    assert.equal(rels.length, 2); // implements + verifies
  });
});

// ═══ 4. removeRelation ══════════════════════════════════════════════════

describe("removeRelation", () => {
  it("removes existing relation", () => {
    const r = addRelation(db, { fromId: "FR-01", toId: "FR-02", type: "depends_on" });
    assert.equal(removeRelation(db, r.id), true);
    assert.equal(getRelations(db, "FR-01").length, 0);
  });

  it("returns false for non-existent relation", () => {
    assert.equal(removeRelation(db, "nonexistent"), false);
  });
});

// ═══ 5. getRelationsByType ══════════════════════════════════════════════

describe("getRelationsByType", () => {
  it("returns relations of specific type", () => {
    addRelation(db, { fromId: "FR-01", toId: "FR-02", type: "depends_on" });
    addRelation(db, { fromId: "PLN-01", toId: "FR-01", type: "implements" });
    const deps = getRelationsByType(db, "depends_on");
    assert.equal(deps.length, 1);
    assert.equal(deps[0].type, "depends_on");
  });
});

// ═══ 6. Allowed Edge Matrix completeness ════════════════════════════════

describe("ALLOWED_EDGES matrix", () => {
  it("has entries for all 17 relation types", () => {
    assert.equal(Object.keys(ALLOWED_EDGES).length, 17);
  });

  it("every entry has at least one allowed edge", () => {
    for (const [type, rules] of Object.entries(ALLOWED_EDGES)) {
      assert.ok(rules.length > 0, `${type} has no allowed edges`);
    }
  });
});
