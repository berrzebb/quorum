/**
 * Tests: Fact Store (FACT WB-1 + WB-2)
 * facts table + addFact/getFacts/promoteFact/archiveStaleFacts.
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";

const { EventStore } = await import("../dist/platform/bus/store.js");

let store;
let tmpDir;

beforeEach(() => {
  tmpDir = mkdtempSync(resolve(tmpdir(), "fact-"));
  store = new EventStore({ dbPath: resolve(tmpDir, "test.db") });
});

afterEach(() => {
  store.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("facts table schema", () => {
  it("creates facts table without error", () => {
    // If we got here, schema creation succeeded
    assert.ok(store);
  });

  it("addFact returns an id", () => {
    const id = store.addFact({ category: "audit_pattern", content: "missing null check" });
    assert.ok(id);
    assert.equal(typeof id, "string");
  });
});

describe("addFact", () => {
  it("inserts new fact with default values", () => {
    store.addFact({ category: "error_pattern", content: "off-by-one" });
    const facts = store.getFacts();
    assert.equal(facts.length, 1);
    assert.equal(facts[0].category, "error_pattern");
    assert.equal(facts[0].content, "off-by-one");
    assert.equal(facts[0].scope, "project");
    assert.equal(facts[0].status, "candidate");
    assert.equal(facts[0].frequency, 1);
  });

  it("deduplicates exact content — increments frequency", () => {
    store.addFact({ category: "audit_pattern", content: "missing test" });
    store.addFact({ category: "audit_pattern", content: "missing test" });
    store.addFact({ category: "audit_pattern", content: "missing test" });
    const facts = store.getFacts();
    assert.equal(facts.length, 1);
    assert.equal(facts[0].frequency, 3);
  });

  it("different content → separate facts", () => {
    store.addFact({ category: "audit_pattern", content: "fact A" });
    store.addFact({ category: "audit_pattern", content: "fact B" });
    assert.equal(store.getFacts().length, 2);
  });

  it("respects projectId for dedup scope", () => {
    store.addFact({ category: "audit_pattern", content: "same", projectId: "proj-1" });
    store.addFact({ category: "audit_pattern", content: "same", projectId: "proj-2" });
    // Different projects → separate facts
    assert.equal(store.getFacts().length, 2);
  });
});

describe("getFacts", () => {
  it("filters by status", () => {
    const id = store.addFact({ category: "error_pattern", content: "null deref" });
    store.promoteFact(id, "established");
    store.addFact({ category: "error_pattern", content: "other" });
    const established = store.getFacts({ status: "established" });
    assert.equal(established.length, 1);
    assert.equal(established[0].content, "null deref");
  });

  it("filters by category", () => {
    store.addFact({ category: "audit_pattern", content: "a" });
    store.addFact({ category: "domain_finding", content: "b" });
    assert.equal(store.getFacts({ category: "audit_pattern" }).length, 1);
  });

  it("respects limit", () => {
    for (let i = 0; i < 10; i++) store.addFact({ category: "test", content: `fact-${i}` });
    assert.equal(store.getFacts({ limit: 3 }).length, 3);
  });

  it("orders by frequency DESC", () => {
    store.addFact({ category: "test", content: "low" });
    const highId = store.addFact({ category: "test", content: "high" });
    store.addFact({ category: "test", content: "high" }); // freq=2
    store.addFact({ category: "test", content: "high" }); // freq=3
    const facts = store.getFacts();
    assert.equal(facts[0].content, "high");
    assert.equal(facts[0].frequency, 3);
  });
});

describe("promoteFact", () => {
  it("changes status to established", () => {
    const id = store.addFact({ category: "test", content: "promote me" });
    store.promoteFact(id, "established");
    const facts = store.getFacts({ status: "established" });
    assert.equal(facts.length, 1);
    assert.equal(facts[0].id, id);
  });

  it("changes status to archived", () => {
    const id = store.addFact({ category: "test", content: "archive me" });
    store.promoteFact(id, "archived");
    assert.equal(store.getFacts({ status: "archived" }).length, 1);
  });
});

describe("archiveStaleFacts", () => {
  it("archives old candidates", () => {
    store.addFact({ category: "test", content: "old fact" });
    // Manually backdate
    store.db.prepare("UPDATE facts SET updated_at = ?").run(Date.now() - 100_000);
    const archived = store.archiveStaleFacts(50_000); // older than 50s
    assert.equal(archived, 1);
    assert.equal(store.getFacts({ status: "archived" }).length, 1);
  });

  it("does not archive established facts", () => {
    const id = store.addFact({ category: "test", content: "established" });
    store.promoteFact(id, "established");
    store.db.prepare("UPDATE facts SET updated_at = ?").run(Date.now() - 100_000);
    const archived = store.archiveStaleFacts(50_000);
    assert.equal(archived, 0);
  });

  it("does not archive recent candidates", () => {
    store.addFact({ category: "test", content: "recent" });
    const archived = store.archiveStaleFacts(100_000_000); // way in future
    assert.equal(archived, 0); // just created, so updated_at > cutoff
  });
});
