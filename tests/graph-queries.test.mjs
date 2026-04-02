#!/usr/bin/env node
/**
 * GRAPH-6: Gap Detection SQL Tests
 *
 * Tests findGaps() and convenience queries:
 * - Unimplemented requirements
 * - Untested requirements
 * - Unvalidated decisions
 * - Unresolved questions
 * - Orphan entities
 * - Type filter
 * - GapType filter
 *
 * Run: node --test tests/graph-queries.test.mjs
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

const { EventStore } = await import("../dist/platform/bus/store.js");
const { addEntity } = await import("../dist/platform/bus/graph-schema.js");
const { addRelation } = await import("../dist/platform/bus/graph-relations.js");
const {
  findGaps, findUnimplemented, findUntested, findOrphans,
} = await import("../dist/platform/bus/graph-queries.js");

let store;
let db;

beforeEach(() => {
  store = new EventStore(":memory:");
  db = store.db;
});

afterEach(() => { store.close(); });

// ═══ Helper ══════════════════════════════════════════════════════════

function seedBasicGraph() {
  addEntity(db, { id: "FR-01", type: "requirement", title: "Feature 1", status: "active" });
  addEntity(db, { id: "FR-02", type: "requirement", title: "Feature 2", status: "active" });
  addEntity(db, { id: "FR-03", type: "requirement", title: "Feature 3 (deprecated)", status: "deprecated" });
  addEntity(db, { id: "DEC-01", type: "decision", title: "Decision 1", status: "active" });
  addEntity(db, { id: "QST-01", type: "question", title: "Question 1", status: "draft" });
  addEntity(db, { id: "QST-02", type: "question", title: "Question 2", status: "resolved" });
  addEntity(db, { id: "PLN-01", type: "plan", title: "Plan 1", status: "active" });
  addEntity(db, { id: "TST-01", type: "test", title: "Test 1", status: "active" });
  addEntity(db, { id: "CRT-01", type: "criterion", title: "Criterion 1", status: "active" });

  // FR-01 is implemented and tested
  addRelation(db, { fromId: "PLN-01", toId: "FR-01", type: "implements" });
  addRelation(db, { fromId: "TST-01", toId: "FR-01", type: "verifies" });

  // DEC-01 is validated
  addRelation(db, { fromId: "DEC-01", toId: "CRT-01", type: "validates_against" });

  // FR-02 has NO implements or verifies — should be a gap
}

// ═══ 1. Unimplemented ═══════════════════════════════════════════════

describe("findGaps — unimplemented", () => {
  it("detects requirement without implements relation", () => {
    seedBasicGraph();
    const gaps = findUnimplemented(db);
    assert.equal(gaps.length, 1);
    assert.equal(gaps[0].entityId, "FR-02");
    assert.equal(gaps[0].gapType, "unimplemented");
  });

  it("excludes deprecated requirements", () => {
    seedBasicGraph();
    const gaps = findUnimplemented(db);
    const deprecated = gaps.find(g => g.entityId === "FR-03");
    assert.equal(deprecated, undefined);
  });

  it("excludes implemented requirements", () => {
    seedBasicGraph();
    const gaps = findUnimplemented(db);
    const implemented = gaps.find(g => g.entityId === "FR-01");
    assert.equal(implemented, undefined);
  });
});

// ═══ 2. Untested ════════════════════════════════════════════════════

describe("findGaps — untested", () => {
  it("detects requirement without verifies relation", () => {
    seedBasicGraph();
    const gaps = findUntested(db);
    assert.equal(gaps.length, 1);
    assert.equal(gaps[0].entityId, "FR-02");
    assert.equal(gaps[0].gapType, "untested");
  });

  it("returns empty when all requirements tested", () => {
    seedBasicGraph();
    addRelation(db, { fromId: "TST-01", toId: "FR-02", type: "verifies" });
    const gaps = findUntested(db);
    assert.equal(gaps.length, 0);
  });
});

// ═══ 3. Unvalidated ═════════════════════════════════════════════════

describe("findGaps — unvalidated", () => {
  it("detects decision without validates_against when removed", () => {
    addEntity(db, { id: "DEC-01", type: "decision", title: "Decision 1", status: "active" });
    const gaps = findGaps(db, { gapTypes: ["unvalidated"] });
    assert.equal(gaps.length, 1);
    assert.equal(gaps[0].entityId, "DEC-01");
  });

  it("excludes validated decisions", () => {
    seedBasicGraph();
    const gaps = findGaps(db, { gapTypes: ["unvalidated"] });
    assert.equal(gaps.length, 0);
  });
});

// ═══ 4. Unresolved questions ════════════════════════════════════════

describe("findGaps — unresolved", () => {
  it("detects unresolved questions", () => {
    seedBasicGraph();
    const gaps = findGaps(db, { gapTypes: ["unresolved"] });
    assert.equal(gaps.length, 1);
    assert.equal(gaps[0].entityId, "QST-01");
  });

  it("excludes resolved questions", () => {
    seedBasicGraph();
    const gaps = findGaps(db, { gapTypes: ["unresolved"] });
    const resolved = gaps.find(g => g.entityId === "QST-02");
    assert.equal(resolved, undefined);
  });
});

// ═══ 5. Orphan entities ═════════════════════════════════════════════

describe("findGaps — orphan", () => {
  it("detects entities with no relations", () => {
    addEntity(db, { id: "ORPHAN-1", type: "requirement", title: "Lonely" });
    const gaps = findOrphans(db);
    assert.equal(gaps.length, 1);
    assert.equal(gaps[0].entityId, "ORPHAN-1");
    assert.equal(gaps[0].gapType, "orphan");
  });

  it("excludes entities that have relations", () => {
    seedBasicGraph();
    const gaps = findOrphans(db);
    // FR-01, PLN-01, TST-01, DEC-01, CRT-01 all have relations
    // FR-02, QST-01, QST-02 have no relations = orphans
    const orphanIds = gaps.map(g => g.entityId);
    assert.ok(!orphanIds.includes("FR-01"));
    assert.ok(!orphanIds.includes("PLN-01"));
    assert.ok(orphanIds.includes("FR-02"));
    assert.ok(orphanIds.includes("QST-01"));
  });

  it("filters orphans by type", () => {
    seedBasicGraph();
    const gaps = findOrphans(db, "question");
    for (const g of gaps) {
      assert.equal(g.entityType, "question");
    }
  });
});

// ═══ 6. findGaps — combined ═════════════════════════════════════════

describe("findGaps — combined", () => {
  it("returns all gap types when no filter", () => {
    seedBasicGraph();
    const gaps = findGaps(db);
    const gapTypes = new Set(gaps.map(g => g.gapType));
    assert.ok(gapTypes.has("unimplemented"));
    assert.ok(gapTypes.has("untested"));
    assert.ok(gapTypes.has("unresolved"));
    assert.ok(gapTypes.has("orphan"));
  });

  it("filters by entity type", () => {
    seedBasicGraph();
    const gaps = findGaps(db, { type: "requirement" });
    for (const g of gaps) {
      assert.equal(g.entityType, "requirement");
    }
  });

  it("filters by gap types", () => {
    seedBasicGraph();
    const gaps = findGaps(db, { gapTypes: ["unimplemented", "untested"] });
    for (const g of gaps) {
      assert.ok(g.gapType === "unimplemented" || g.gapType === "untested");
    }
  });

  it("returns Gap with all required fields", () => {
    seedBasicGraph();
    const gaps = findGaps(db);
    for (const g of gaps) {
      assert.ok(g.entityId);
      assert.ok(g.entityType);
      assert.ok(g.gapType);
      assert.ok(g.title);
    }
  });
});

// ═══ 7. Edge cases ══════════════════════════════════════════════════

describe("findGaps — edge cases", () => {
  it("returns empty array on empty database", () => {
    const gaps = findGaps(db);
    assert.deepEqual(gaps, []);
  });

  it("handles unknown gap type gracefully", () => {
    const gaps = findGaps(db, { gapTypes: ["bogus"] });
    assert.deepEqual(gaps, []);
  });
});
