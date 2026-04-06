/**
 * Tests for v0.6.5 GRAPH Track — Knowledge Graph Engine.
 *
 * Covers: schema migration, FTS5 search, graph queries (forward/reverse/RTM),
 * facts migration, node/edge CRUD, agent trust.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, unlinkSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

// Import from compiled dist/ — TS modules need build first
const { openDatabase } = await import("../dist/platform/bus/sqlite-adapter.js");

// ── Test DB Setup ─────────────────────────────────

const TEST_DIR = join(tmpdir(), "quorum-graph-test");
let db;

function freshDb() {
  const path = join(TEST_DIR, `test-${randomUUID().slice(0, 8)}.db`);
  const d = openDatabase(path);
  d.pragma("journal_mode = WAL");
  d.pragma("synchronous = NORMAL");

  // Create base schema (entities + relations + facts)
  d.exec(`
    CREATE TABLE IF NOT EXISTS entities (
      id          TEXT PRIMARY KEY,
      type        TEXT NOT NULL,
      title       TEXT NOT NULL,
      description TEXT,
      status      TEXT NOT NULL DEFAULT 'draft',
      metadata    TEXT NOT NULL DEFAULT '{}',
      created_at  INTEGER NOT NULL,
      updated_at  INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_entities_type ON entities (type);
    CREATE INDEX IF NOT EXISTS idx_entities_status ON entities (status);

    CREATE TABLE IF NOT EXISTS relations (
      id          TEXT PRIMARY KEY,
      from_id     TEXT NOT NULL,
      to_id       TEXT NOT NULL,
      type        TEXT NOT NULL,
      weight      REAL NOT NULL DEFAULT 1.0,
      metadata    TEXT NOT NULL DEFAULT '{}',
      created_at  INTEGER NOT NULL,
      FOREIGN KEY (from_id) REFERENCES entities(id),
      FOREIGN KEY (to_id) REFERENCES entities(id)
    );
    CREATE INDEX IF NOT EXISTS idx_relations_from ON relations (from_id);
    CREATE INDEX IF NOT EXISTS idx_relations_to ON relations (to_id);
    CREATE INDEX IF NOT EXISTS idx_relations_type ON relations (type);

    CREATE TABLE IF NOT EXISTS facts (
      id          TEXT PRIMARY KEY,
      scope       TEXT NOT NULL DEFAULT 'project',
      category    TEXT NOT NULL,
      content     TEXT NOT NULL,
      frequency   INTEGER NOT NULL DEFAULT 1,
      status      TEXT NOT NULL DEFAULT 'candidate',
      project_id  TEXT,
      created_at  INTEGER NOT NULL,
      updated_at  INTEGER NOT NULL
    );
  `);

  return d;
}

before(() => {
  if (!existsSync(TEST_DIR)) mkdirSync(TEST_DIR, { recursive: true });
});

// ── graph-migrate tests ─────────────────────────

describe("graph-migrate", async () => {
  const { migrateEntityColumns, setupFTS5, migrateFacts, runGraphMigration } =
    await import("../dist/platform/bus/graph-migrate.js");

  it("adds embedding and project_id columns", () => {
    const d = freshDb();
    const result = migrateEntityColumns(d);
    assert.deepStrictEqual(result.added, ["embedding", "project_id"]);
    d.close();
  });

  it("is idempotent — second run adds nothing", () => {
    const d = freshDb();
    migrateEntityColumns(d);
    const result2 = migrateEntityColumns(d);
    assert.deepStrictEqual(result2.added, []);
    d.close();
  });

  it("sets up FTS5 virtual table", () => {
    const d = freshDb();
    const ok = setupFTS5(d);
    assert.ok(ok, "FTS5 setup should succeed");

    // Verify table exists
    const row = d.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='entities_fts'"
    ).get();
    assert.ok(row, "entities_fts table should exist");
    d.close();
  });

  it("FTS5 is idempotent", () => {
    const d = freshDb();
    assert.ok(setupFTS5(d));
    assert.ok(setupFTS5(d)); // second call should also succeed
    d.close();
  });

  it("FTS5 triggers sync on INSERT", () => {
    const d = freshDb();
    setupFTS5(d);

    const now = Date.now();
    d.prepare(
      "INSERT INTO entities (id, type, title, description, status, metadata, created_at, updated_at) VALUES (?, ?, ?, ?, ?, '{}', ?, ?)"
    ).run("test-1", "Fact", "bridge wiring issue", "PostToolUse violation detection not connected", "active", now, now);

    const results = d.prepare(
      "SELECT * FROM entities_fts WHERE entities_fts MATCH 'bridge'"
    ).all();
    assert.ok(results.length > 0, "FTS5 should find 'bridge'");
    d.close();
  });

  it("migrates facts to entities", () => {
    const d = freshDb();
    migrateEntityColumns(d);

    const now = Date.now();
    // Insert some facts
    d.prepare(
      "INSERT INTO facts (id, scope, category, content, frequency, status, project_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run("fact-1", "project", "audit_pattern", "null check missing 3 times", 3, "established", "quorum", now, now);
    d.prepare(
      "INSERT INTO facts (id, scope, category, content, frequency, status, project_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run("fact-2", "global", "error_pattern", "stub return detected", 5, "established", null, now, now);

    const result = migrateFacts(d);
    assert.equal(result.migrated, 2);
    assert.equal(result.skipped, 0);
    assert.ok(result.edges >= 2, "Should create category edges");

    // Verify entities created
    const e1 = d.prepare("SELECT * FROM entities WHERE id = 'fact-1'").get();
    assert.ok(e1, "fact-1 should be in entities");
    assert.equal(e1.type, "Fact");
    assert.equal(e1.project_id, "quorum");

    const e2 = d.prepare("SELECT * FROM entities WHERE id = 'fact-2'").get();
    assert.ok(e2, "fact-2 should be in entities");
    assert.equal(e2.project_id, null); // global scope

    d.close();
  });

  it("facts migration is idempotent", () => {
    const d = freshDb();
    migrateEntityColumns(d);

    const now = Date.now();
    d.prepare(
      "INSERT INTO facts (id, scope, category, content, frequency, status, project_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run("fact-x", "project", "test", "test content", 1, "candidate", null, now, now);

    const r1 = migrateFacts(d);
    assert.equal(r1.migrated, 1);

    const r2 = migrateFacts(d);
    assert.equal(r2.skipped, 1);
    assert.equal(r2.migrated, 0);
    d.close();
  });

  it("runGraphMigration runs all steps", () => {
    const d = freshDb();
    const report = runGraphMigration(d);
    assert.ok(report.columns.added.length > 0);
    assert.ok(report.fts5);
    d.close();
  });
});

// ── graph-search tests ──────────────────────────

describe("graph-search", async () => {
  const { searchKeyword } = await import("../dist/platform/bus/graph-search.js");
  const { setupFTS5 } = await import("../dist/platform/bus/graph-migrate.js");

  function seedDb() {
    const d = freshDb();
    setupFTS5(d);

    const now = Date.now();
    const insert = d.prepare(
      "INSERT INTO entities (id, type, title, description, status, metadata, created_at, updated_at) VALUES (?, ?, ?, ?, 'active', '{}', ?, ?)"
    );

    insert.run("e1", "Pattern", "bridge wiring disconnected", "PostToolUse not wired to rule registry", now, now);
    insert.run("e2", "Fact", "null check missing in auth", "auth middleware missing null validation", now, now);
    insert.run("e3", "Pattern", "stub return after completion", "Agent returns stub code then declares done", now, now);
    insert.run("e4", "Decision", "CLI surface 5 commands", "setup steering status eval daemon", now, now);
    insert.run("e5", "Fact", "bridge has 71 functions", "Too many functions in bridge namespace", now, now);

    return d;
  }

  it("finds entities by keyword", () => {
    const d = seedDb();
    const results = searchKeyword(d, "bridge", { limit: 10 });
    assert.ok(results.length >= 2, `Expected >=2 results for 'bridge', got ${results.length}`);
    d.close();
  });

  it("filters by type", () => {
    const d = seedDb();
    const results = searchKeyword(d, "bridge", { type: "Pattern" });
    assert.ok(results.every(r => r.type === "Pattern"));
    d.close();
  });

  it("returns empty for non-matching query", () => {
    const d = seedDb();
    const results = searchKeyword(d, "zzznonexistent");
    assert.equal(results.length, 0);
    d.close();
  });

  it("respects limit", () => {
    const d = seedDb();
    const results = searchKeyword(d, "bridge OR null OR stub OR CLI", { limit: 2 });
    assert.ok(results.length <= 2);
    d.close();
  });
});

// ── graph-query tests ───────────────────────────

describe("graph-query", async () => {
  const {
    addNode, addEdge, queryForward, queryReverse,
    traceRTM, queryPatternHistory, queryAgentTrust,
    queryNodes, queryEdges, updateNode,
  } = await import("../dist/platform/bus/graph-query.js");
  const { migrateEntityColumns, setupFTS5 } = await import("../dist/platform/bus/graph-migrate.js");

  function seedGraph() {
    const d = freshDb();
    migrateEntityColumns(d);
    setupFTS5(d);

    // Create a mini dependency graph:
    // FR-1 --implements--> bridge.mjs --imports--> store.ts --imports--> sqlite-adapter.ts
    //                      bridge.mjs --tested-by--> bridge.test.mjs
    addNode(d, { id: "FR-1", type: "FR", title: "Node/Edge Schema" });
    addNode(d, { id: "bridge.mjs", type: "File", title: "bridge.mjs" });
    addNode(d, { id: "store.ts", type: "File", title: "store.ts" });
    addNode(d, { id: "sqlite-adapter.ts", type: "File", title: "sqlite-adapter.ts" });
    addNode(d, { id: "bridge.test.mjs", type: "Test", title: "bridge.test.mjs" });

    addEdge(d, { fromId: "FR-1", toId: "bridge.mjs", type: "implements" });
    addEdge(d, { fromId: "bridge.mjs", toId: "store.ts", type: "imports" });
    addEdge(d, { fromId: "store.ts", toId: "sqlite-adapter.ts", type: "imports" });
    addEdge(d, { fromId: "bridge.mjs", toId: "bridge.test.mjs", type: "tested-by" });

    return d;
  }

  it("addNode creates entity", () => {
    const d = freshDb();
    migrateEntityColumns(d);
    const id = addNode(d, { type: "Fact", title: "test fact", description: "desc" });
    const row = d.prepare("SELECT * FROM entities WHERE id = ?").get(id);
    assert.ok(row);
    assert.equal(row.type, "Fact");
    assert.equal(row.title, "test fact");
    d.close();
  });

  it("updateNode modifies entity", () => {
    const d = freshDb();
    migrateEntityColumns(d);
    const id = addNode(d, { type: "Fact", title: "old", status: "draft" });
    const updated = updateNode(d, id, { title: "new", status: "active" });
    assert.ok(updated);
    const row = d.prepare("SELECT * FROM entities WHERE id = ?").get(id);
    assert.equal(row.title, "new");
    assert.equal(row.status, "active");
    d.close();
  });

  it("queryNodes filters by type", () => {
    const d = freshDb();
    migrateEntityColumns(d);
    addNode(d, { type: "Fact", title: "fact1" });
    addNode(d, { type: "Pattern", title: "pattern1" });
    const facts = queryNodes(d, { type: "Fact" });
    assert.ok(facts.length >= 1);
    assert.ok(facts.every(f => f.type === "Fact"));
    d.close();
  });

  it("queryForward follows edges", () => {
    const d = seedGraph();
    const deps = queryForward(d, "bridge.mjs", { edgeType: "imports" });
    assert.equal(deps.length, 1);
    assert.equal(deps[0].id, "store.ts");
    d.close();
  });

  it("queryForward without edge filter returns all", () => {
    const d = seedGraph();
    const all = queryForward(d, "bridge.mjs");
    assert.ok(all.length >= 2); // store.ts + bridge.test.mjs
    d.close();
  });

  it("queryReverse finds dependents (blast radius)", () => {
    const d = seedGraph();
    // Who depends on sqlite-adapter.ts? → store.ts → bridge.mjs (recursive)
    const impact = queryReverse(d, "sqlite-adapter.ts", { edgeType: "imports" });
    const ids = impact.map(e => e.id);
    assert.ok(ids.includes("store.ts"), "store.ts should be in impact");
    assert.ok(ids.includes("bridge.mjs"), "bridge.mjs should be in impact (transitive)");
    d.close();
  });

  it("queryReverse respects maxDepth", () => {
    const d = seedGraph();
    // Depth 1 should only find store.ts, not bridge.mjs
    const impact = queryReverse(d, "sqlite-adapter.ts", { edgeType: "imports", maxDepth: 1 });
    const ids = impact.map(e => e.id);
    assert.ok(ids.includes("store.ts"));
    assert.ok(!ids.includes("bridge.mjs"), "bridge.mjs should NOT be in depth-1 impact");
    d.close();
  });

  it("traceRTM follows FR → implements → File → tested-by → Test", () => {
    const d = seedGraph();
    const trace = traceRTM(d, "FR-1");
    assert.ok(trace);
    assert.equal(trace.fr.id, "FR-1");
    assert.ok(trace.files.some(f => f.id === "bridge.mjs"));
    assert.ok(trace.tests.some(t => t.id === "bridge.test.mjs"));
    d.close();
  });

  it("traceRTM returns null for nonexistent FR", () => {
    const d = seedGraph();
    const trace = traceRTM(d, "FR-999");
    assert.equal(trace, null);
    d.close();
  });

  it("queryPatternHistory finds patterns by edge", () => {
    const d = freshDb();
    migrateEntityColumns(d);
    setupFTS5(d);

    addNode(d, { id: "pattern-1", type: "Pattern", title: "null check failure", description: "null check missing 3 times in bridge.mjs" });
    addNode(d, { id: "bridge.mjs", type: "File", title: "bridge.mjs" });
    addEdge(d, { fromId: "pattern-1", toId: "bridge.mjs", type: "caused" });

    const patterns = queryPatternHistory(d, "bridge.mjs");
    assert.ok(patterns.length >= 1);
    assert.equal(patterns[0].type, "Pattern");
    d.close();
  });

  it("queryAgentTrust returns 100% for new agent", () => {
    const d = freshDb();
    const trust = queryAgentTrust(d, "agent-new");
    assert.equal(trust.trustPct, 100);
    assert.equal(trust.total, 0);
    d.close();
  });

  it("queryAgentTrust calculates correct ratio", () => {
    const d = freshDb();
    migrateEntityColumns(d);
    const now = Date.now();

    // Create agent + session entities (FK constraint)
    addNode(d, { id: "agent-X", type: "Agent", title: "agent-X" });
    for (let i = 1; i <= 5; i++) addNode(d, { id: `session-${i}`, type: "Session", title: `session-${i}` });

    // Simulate: 3 correct, 2 incorrect
    addEdge(d, { fromId: "agent-X", toId: "session-1", type: "completed-correctly" });
    addEdge(d, { fromId: "agent-X", toId: "session-2", type: "completed-correctly" });
    addEdge(d, { fromId: "agent-X", toId: "session-3", type: "completed-correctly" });
    addEdge(d, { fromId: "agent-X", toId: "session-4", type: "completed-incorrectly" });
    addEdge(d, { fromId: "agent-X", toId: "session-5", type: "completed-incorrectly" });

    const trust = queryAgentTrust(d, "agent-X");
    assert.equal(trust.total, 5);
    assert.equal(trust.correct, 3);
    assert.equal(trust.incorrect, 2);
    assert.equal(trust.trustPct, 60);
    d.close();
  });

  it("addEdge and queryEdges work", () => {
    const d = freshDb();
    migrateEntityColumns(d);
    addNode(d, { id: "a", type: "File", title: "a.ts" });
    addNode(d, { id: "b", type: "File", title: "b.ts" });
    addEdge(d, { fromId: "a", toId: "b", type: "imports" });

    const edges = queryEdges(d, { fromId: "a", type: "imports" });
    assert.equal(edges.length, 1);
    assert.equal(edges[0].to_id, "b");
    d.close();
  });
});
