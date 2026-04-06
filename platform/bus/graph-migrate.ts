/**
 * Graph Migration — extend entities table for Knowledge Graph (v0.6.5 GRAPH FR-1,2,5).
 *
 * Adds:
 *   - entities.embedding BLOB (sqlite-vec 384-dim float32)
 *   - entities.project_id TEXT (cross-project scoping)
 *   - FTS5 virtual table on entities(title, description)
 *   - facts → entities migration
 *
 * All migrations are idempotent (safe to re-run).
 * Fail-open: migration errors are logged, never thrown.
 */

import type { SQLiteDatabase } from "./sqlite-adapter.js";
import { randomUUID } from "node:crypto";

// ── Column Migration ────────────────────────────

/** Check if a column exists in a table. */
function hasColumn(db: SQLiteDatabase, table: string, column: string): boolean {
  const cols = db.pragma(`table_info(${table})`) as Array<{ name: string }>;
  return cols.some(c => c.name === column);
}

/**
 * Add embedding and project_id columns to entities table.
 * Idempotent — skips if columns already exist.
 */
export function migrateEntityColumns(db: SQLiteDatabase): { added: string[] } {
  const added: string[] = [];

  if (!hasColumn(db, "entities", "embedding")) {
    db.exec("ALTER TABLE entities ADD COLUMN embedding BLOB");
    added.push("embedding");
  }

  if (!hasColumn(db, "entities", "project_id")) {
    db.exec("ALTER TABLE entities ADD COLUMN project_id TEXT");
    db.exec("CREATE INDEX IF NOT EXISTS idx_entities_project ON entities (project_id)");
    added.push("project_id");
  }

  return { added };
}

// ── FTS5 Setup ──────────────────────────────────

/**
 * Create FTS5 virtual table and sync triggers for full-text search.
 * Content-sync mode: FTS5 mirrors entities(title, description).
 */
export function setupFTS5(db: SQLiteDatabase): boolean {
  try {
    // Check if FTS5 table already exists
    const existing = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='entities_fts'"
    ).get() as { name: string } | undefined;

    if (existing) return true; // Already set up

    db.exec(`
      CREATE VIRTUAL TABLE entities_fts USING fts5(
        title, description,
        content='entities',
        content_rowid='rowid'
      );
    `);

    // Sync triggers — keep FTS5 in sync with entities
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS entities_fts_ai AFTER INSERT ON entities BEGIN
        INSERT INTO entities_fts(rowid, title, description)
        VALUES (new.rowid, new.title, new.description);
      END;
    `);

    db.exec(`
      CREATE TRIGGER IF NOT EXISTS entities_fts_ad AFTER DELETE ON entities BEGIN
        INSERT INTO entities_fts(entities_fts, rowid, title, description)
        VALUES ('delete', old.rowid, old.title, old.description);
      END;
    `);

    db.exec(`
      CREATE TRIGGER IF NOT EXISTS entities_fts_au AFTER UPDATE ON entities BEGIN
        INSERT INTO entities_fts(entities_fts, rowid, title, description)
        VALUES ('delete', old.rowid, old.title, old.description);
        INSERT INTO entities_fts(rowid, title, description)
        VALUES (new.rowid, new.title, new.description);
      END;
    `);

    // Rebuild: populate FTS5 from existing entities data
    db.exec("INSERT INTO entities_fts(entities_fts) VALUES('rebuild')");

    return true;
  } catch (err) {
    console.warn(`[graph-migrate] FTS5 setup failed: ${(err as Error).message}`);
    return false;
  }
}

// ── Facts → Entities Migration ──────────────────

interface MigrationResult {
  migrated: number;
  skipped: number;
  edges: number;
}

/**
 * Migrate facts table rows into entities + relations.
 *
 * Mapping:
 *   facts.id         → entities.id
 *   facts.content    → entities.description
 *   facts.category   → entities.metadata.category
 *   facts.scope      → entities.project_id (global=null, project=project_id)
 *   facts.status     → entities.status
 *   facts.frequency  → entities.metadata.frequency
 *
 * Idempotent: skips facts whose ID already exists in entities.
 */
export function migrateFacts(db: SQLiteDatabase): MigrationResult {
  const result: MigrationResult = { migrated: 0, skipped: 0, edges: 0 };

  try {
    // Check if facts table exists
    const factsTable = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='facts'"
    ).get() as { name: string } | undefined;

    if (!factsTable) return result;

    const facts = db.prepare("SELECT * FROM facts").all() as Array<{
      id: string; scope: string; category: string; content: string;
      frequency: number; status: string; project_id: string | null;
      created_at: number; updated_at: number;
    }>;

    const insertEntity = db.prepare(`
      INSERT OR IGNORE INTO entities (id, type, title, description, status, metadata, project_id, created_at, updated_at)
      VALUES (?, 'Fact', ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertRelation = db.prepare(`
      INSERT OR IGNORE INTO relations (id, from_id, to_id, type, weight, metadata, created_at)
      VALUES (?, ?, ?, 'categorized-as', 1.0, '{}', ?)
    `);

    // Ensure category nodes exist
    const ensureCategory = db.prepare(`
      INSERT OR IGNORE INTO entities (id, type, title, description, status, metadata, created_at, updated_at)
      VALUES (?, 'Category', ?, ?, 'active', '{}', ?, ?)
    `);

    const tx = db.transaction(() => {
      const categoryIds = new Map<string, string>();

      for (const fact of facts) {
        // Check if already migrated
        const exists = db.prepare("SELECT id FROM entities WHERE id = ?").get(fact.id);
        if (exists) {
          result.skipped++;
          continue;
        }

        // Create title from content (first 80 chars)
        const title = fact.content.length > 80
          ? fact.content.slice(0, 77) + "..."
          : fact.content;

        const metadata = JSON.stringify({
          category: fact.category,
          frequency: fact.frequency,
          migratedFrom: "facts",
        });

        const projectId = fact.scope === "global" ? null : (fact.project_id ?? null);

        insertEntity.run(
          fact.id, title, fact.content, fact.status,
          metadata, projectId, fact.created_at, fact.updated_at
        );
        result.migrated++;

        // Create category edge
        if (!categoryIds.has(fact.category)) {
          const catId = `cat-${fact.category}`;
          ensureCategory.run(catId, fact.category, `Category: ${fact.category}`, fact.created_at, fact.created_at);
          categoryIds.set(fact.category, catId);
        }

        const catId = categoryIds.get(fact.category)!;
        insertRelation.run(randomUUID(), fact.id, catId, fact.created_at);
        result.edges++;
      }
    });

    tx();
    return result;
  } catch (err) {
    console.warn(`[graph-migrate] Facts migration failed: ${(err as Error).message}`);
    return result;
  }
}

// ── Full Migration ──────────────────────────────

export interface GraphMigrationReport {
  columns: { added: string[] };
  fts5: boolean;
  facts: MigrationResult;
}

/**
 * Run all graph migrations. Safe to call on every startup.
 * Fail-open: each step is independent — partial success is fine.
 */
export function runGraphMigration(db: SQLiteDatabase): GraphMigrationReport {
  const columns = migrateEntityColumns(db);
  const fts5 = setupFTS5(db);
  const facts = migrateFacts(db);
  return { columns, fts5, facts };
}
