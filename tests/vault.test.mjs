/**
 * Tests for v0.6.5 VAULT Track — Obsidian Knowledge Graph View.
 *
 * Covers: node→markdown export, vault structure, wikilinks, reverse sync.
 */
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

const { openDatabase } = await import("../dist/platform/bus/sqlite-adapter.js");
const { migrateEntityColumns, setupFTS5 } = await import("../dist/platform/bus/graph-migrate.js");
const { addNode, addEdge } = await import("../dist/platform/bus/graph-query.js");
const { exportNode, exportAll } = await import("../dist/platform/vault/exporter.js");
const { importVaultChanges } = await import("../dist/platform/vault/importer.js");

const TEST_DIR = join(tmpdir(), "quorum-vault-test");
const VAULT_DIR = join(TEST_DIR, "vault");

function freshDb() {
  const path = join(TEST_DIR, `test-${randomUUID().slice(0, 8)}.db`);
  const d = openDatabase(path);
  d.pragma("journal_mode = WAL");
  d.exec(`
    CREATE TABLE IF NOT EXISTS entities (
      id TEXT PRIMARY KEY, type TEXT NOT NULL, title TEXT NOT NULL,
      description TEXT, status TEXT NOT NULL DEFAULT 'draft',
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS relations (
      id TEXT PRIMARY KEY, from_id TEXT NOT NULL, to_id TEXT NOT NULL,
      type TEXT NOT NULL, weight REAL NOT NULL DEFAULT 1.0,
      metadata TEXT NOT NULL DEFAULT '{}', created_at INTEGER NOT NULL,
      FOREIGN KEY (from_id) REFERENCES entities(id),
      FOREIGN KEY (to_id) REFERENCES entities(id)
    );
  `);
  migrateEntityColumns(d);
  setupFTS5(d);
  return d;
}

before(() => {
  mkdirSync(TEST_DIR, { recursive: true });
  // Set vault path via env for tests
  process.env.QUORUM_VAULT_PATH = VAULT_DIR;
});

describe("vault exporter", () => {
  it("exports a Fact node to markdown", () => {
    const d = freshDb();
    const id = addNode(d, {
      type: "Fact",
      title: "bridge wiring issue",
      description: "PostToolUse not wired to rule registry, 6 times",
      status: "established",
      metadata: { tags: ["bridge", "wiring"], category: "audit_pattern" },
      projectId: "quorum",
    });

    const result = exportNode(d, id);
    assert.ok(result, "should return export result");
    assert.ok(existsSync(result.path), `file should exist at ${result.path}`);

    const content = readFileSync(result.path, "utf8");
    assert.ok(content.includes("---"), "should have frontmatter");
    assert.ok(content.includes("type: Fact"), "should have type");
    assert.ok(content.includes("status: established"), "should have status");
    assert.ok(content.includes("PostToolUse not wired"), "should have description");
    assert.ok(content.includes("project: quorum"), "should have project");
    d.close();
  });

  it("exports Rule to rules/{level}/ directory", () => {
    const d = freshDb();
    const id = addNode(d, {
      type: "Rule",
      title: "no console log in production",
      description: "console.log 사용 금지",
      status: "hard",
    });

    const result = exportNode(d, id);
    assert.ok(result);
    assert.ok(result.path.includes("rules"), "should be in rules dir");
    assert.ok(result.path.includes("hard"), "should be in hard subdir");
    d.close();
  });

  it("includes wikilinks from relations", () => {
    const d = freshDb();
    const factId = addNode(d, { type: "Fact", title: "null check missing", description: "test content" });
    const fileId = addNode(d, { type: "File", title: "bridge.mjs", description: "bridge file" });
    addEdge(d, { fromId: factId, toId: fileId, type: "caused" });

    const result = exportNode(d, factId);
    assert.ok(result);
    const content = readFileSync(result.path, "utf8");
    assert.ok(content.includes("## Related"), "should have Related section");
    assert.ok(content.includes("[[bridge"), "should have wikilink to bridge");
    d.close();
  });

  it("exportAll exports multiple entities", () => {
    const d = freshDb();
    addNode(d, { type: "Fact", title: "fact one", description: "desc1" });
    addNode(d, { type: "Pattern", title: "pattern one", description: "desc2" });
    addNode(d, { type: "Decision", title: "decision one", description: "desc3" });

    const result = exportAll(d);
    assert.ok(result.exported >= 3, `should export at least 3, got ${result.exported}`);
    d.close();
  });

  it("returns null for nonexistent entity", () => {
    const d = freshDb();
    const result = exportNode(d, "nonexistent-id");
    assert.equal(result, null);
    d.close();
  });
});

describe("vault importer", () => {
  it("detects new .md file and creates entity", () => {
    const d = freshDb();
    const importDir = join(VAULT_DIR, "_import_test");
    mkdirSync(importDir, { recursive: true });

    // Write a .md file directly (simulating Obsidian edit)
    const mdPath = join(importDir, "new-fact.md");
    writeFileSync(mdPath, [
      "---",
      "type: Fact",
      "status: active",
      "tags: [test, import]",
      "---",
      "",
      "This is a manually created fact from Obsidian.",
    ].join("\n"), "utf8");

    const result = importVaultChanges(d, VAULT_DIR, 0); // since=0 → scan everything
    assert.ok(result.created >= 1, `should create at least 1, got ${result.created}`);

    // Verify entity was created
    const entities = d.prepare("SELECT * FROM entities WHERE type = 'Fact' AND description LIKE '%manually created%'").all();
    assert.ok(entities.length >= 1, "should find the imported fact");

    // Cleanup
    rmSync(importDir, { recursive: true, force: true });
    d.close();
  });

  it("updates existing entity by frontmatter id", () => {
    const d = freshDb();
    const id = addNode(d, { type: "Fact", title: "updatable", description: "original" });

    const importDir = join(VAULT_DIR, "_update_test");
    mkdirSync(importDir, { recursive: true });

    writeFileSync(join(importDir, "updatable.md"), [
      "---",
      `id: ${id}`,
      "type: Fact",
      "status: established",
      "---",
      "",
      "Updated from Obsidian.",
    ].join("\n"), "utf8");

    const result = importVaultChanges(d, VAULT_DIR, 0);
    assert.ok(result.updated >= 1, `should update at least 1, got ${result.updated}`);

    const row = d.prepare("SELECT description, status FROM entities WHERE id = ?").get(id);
    assert.equal(row.description, "Updated from Obsidian.");
    assert.equal(row.status, "established");

    rmSync(importDir, { recursive: true, force: true });
    d.close();
  });

  it("returns zeros when vault doesn't exist", () => {
    const d = freshDb();
    const result = importVaultChanges(d, "/nonexistent/vault", 0);
    assert.equal(result.created, 0);
    assert.equal(result.updated, 0);
    d.close();
  });
});
