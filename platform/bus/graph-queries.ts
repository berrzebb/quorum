/**
 * Graph Queries — SQL-based gap detection on entity/relation tables.
 *
 * Replaces markdown-based gap detection with direct SQL queries.
 * Exposes findGaps() for common gap patterns:
 * - Unimplemented requirements (no implements relation)
 * - Untested requirements (no verifies relation)
 * - Unvalidated decisions (no validates_against relation)
 * - Unresolved questions (status != resolved)
 * - Orphan entities (no relations at all)
 *
 * @module bus/graph-queries
 */

import type { EntityType } from "./graph-schema.js";

// ── Types ────────────────────────────────────

export type GapType =
  | 'unimplemented'     // requirement with no implements relation
  | 'untested'          // requirement with no verifies relation
  | 'unvalidated'       // decision with no validates_against relation
  | 'unresolved'        // question with status != resolved
  | 'orphan';           // entity with no relations

export interface Gap {
  entityId: string;
  entityType: EntityType;
  gapType: GapType;
  title: string;
}

export interface FindGapsOptions {
  type?: EntityType;
  gapTypes?: GapType[];
}

// ── Database interface ──────────────────────

interface SQLiteStatement {
  run(...params: unknown[]): { changes: number };
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

interface SQLiteDatabase {
  prepare(sql: string): SQLiteStatement;
}

// ── Gap detection queries ───────────────────

const GAP_QUERIES: Record<GapType, { sql: string; entityType: EntityType }> = {
  unimplemented: {
    sql: `SELECT id, type, title FROM entities
          WHERE type = 'requirement' AND status != 'deprecated' AND status != 'deleted'
          AND id NOT IN (SELECT to_id FROM relations WHERE type = 'implements')`,
    entityType: 'requirement',
  },
  untested: {
    sql: `SELECT id, type, title FROM entities
          WHERE type = 'requirement' AND status != 'deprecated' AND status != 'deleted'
          AND id NOT IN (SELECT to_id FROM relations WHERE type = 'verifies')`,
    entityType: 'requirement',
  },
  unvalidated: {
    sql: `SELECT id, type, title FROM entities
          WHERE type = 'decision' AND status != 'deprecated' AND status != 'deleted'
          AND id NOT IN (SELECT from_id FROM relations WHERE type = 'validates_against')`,
    entityType: 'decision',
  },
  unresolved: {
    sql: `SELECT id, type, title FROM entities
          WHERE type = 'question' AND status != 'resolved' AND status != 'deleted'`,
    entityType: 'question',
  },
  orphan: {
    sql: `SELECT id, type, title FROM entities
          WHERE status != 'deleted'
          AND id NOT IN (SELECT from_id FROM relations)
          AND id NOT IN (SELECT to_id FROM relations)`,
    entityType: 'requirement', // placeholder — actual type comes from result
  },
};

// ── Core function ───────────────────────────

export function findGaps(db: SQLiteDatabase, options?: FindGapsOptions): Gap[] {
  const gaps: Gap[] = [];
  const gapTypes = options?.gapTypes ?? (Object.keys(GAP_QUERIES) as GapType[]);
  const typeFilter = options?.type;

  for (const gapType of gapTypes) {
    const query = GAP_QUERIES[gapType];
    if (!query) continue;

    // Skip if type filter doesn't match this gap's entity type
    // (except orphan which can be any type)
    if (typeFilter && gapType !== 'orphan' && query.entityType !== typeFilter) continue;

    let sql = query.sql;

    // For orphan, optionally filter by entity type
    if (gapType === 'orphan' && typeFilter) {
      sql = `SELECT id, type, title FROM entities
             WHERE type = ? AND status != 'deleted'
             AND id NOT IN (SELECT from_id FROM relations)
             AND id NOT IN (SELECT to_id FROM relations)`;
      const rows = db.prepare(sql).all(typeFilter) as any[];
      for (const row of rows) {
        gaps.push({ entityId: row.id, entityType: row.type, gapType, title: row.title });
      }
      continue;
    }

    const rows = db.prepare(sql).all() as any[];
    for (const row of rows) {
      if (typeFilter && row.type !== typeFilter) continue;
      gaps.push({ entityId: row.id, entityType: row.type, gapType, title: row.title });
    }
  }

  return gaps;
}

// ── Convenience queries ─────────────────────

export function findUnimplemented(db: SQLiteDatabase): Gap[] {
  return findGaps(db, { gapTypes: ['unimplemented'] });
}

export function findUntested(db: SQLiteDatabase): Gap[] {
  return findGaps(db, { gapTypes: ['untested'] });
}

export function findOrphans(db: SQLiteDatabase, type?: EntityType): Gap[] {
  return findGaps(db, { gapTypes: ['orphan'], type });
}
