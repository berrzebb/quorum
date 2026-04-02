/**
 * Graph History — changeset recording for entity/relation modifications.
 *
 * Groups related changes into changesets. Each changeset can contain
 * multiple entity_changes and relation_changes. Publishes graph.changeset
 * event to the EventStore events table.
 *
 * @module bus/graph-history
 */

import { randomUUID } from "node:crypto";

// ── Types ────────────────────────────────────

export type ChangeAction = 'create' | 'update' | 'delete';

export interface Changeset {
  id: string;
  source: string;
  description?: string;
  createdAt: number;
}

export interface EntityChange {
  id: string;
  changesetId: string;
  entityId: string;
  action: ChangeAction;
  beforeData: Record<string, unknown> | null;
  afterData: Record<string, unknown> | null;
}

export interface RelationChange {
  id: string;
  changesetId: string;
  relationId: string;
  action: ChangeAction;
  beforeData: Record<string, unknown> | null;
  afterData: Record<string, unknown> | null;
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

// ── Row conversion ──────────────────────────

function rowToChangeset(row: any): Changeset {
  return {
    id: row.id,
    source: row.source,
    description: row.description ?? undefined,
    createdAt: row.created_at,
  };
}

function rowToEntityChange(row: any): EntityChange {
  return {
    id: row.id,
    changesetId: row.changeset_id,
    entityId: row.entity_id,
    action: row.action as ChangeAction,
    beforeData: row.before_data ? JSON.parse(row.before_data) : null,
    afterData: row.after_data ? JSON.parse(row.after_data) : null,
  };
}

function rowToRelationChange(row: any): RelationChange {
  return {
    id: row.id,
    changesetId: row.changeset_id,
    relationId: row.relation_id,
    action: row.action as ChangeAction,
    beforeData: row.before_data ? JSON.parse(row.before_data) : null,
    afterData: row.after_data ? JSON.parse(row.after_data) : null,
  };
}

// ── CRUD ─────────────────────────────────────

export function createChangeset(
  db: SQLiteDatabase,
  opts: { source?: string; description?: string } = {},
): Changeset {
  const id = randomUUID();
  const now = Date.now();
  const source = opts.source ?? 'manual';

  db.prepare(
    `INSERT INTO changesets (id, source, description, created_at) VALUES (?, ?, ?, ?)`
  ).run(id, source, opts.description ?? null, now);

  // Publish graph.changeset event if events table exists
  try {
    db.prepare(
      `INSERT INTO events (id, aggregate_type, aggregate_id, event_type, source, payload, timestamp)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(randomUUID(), 'graph', id, 'graph.changeset', source, JSON.stringify({ changesetId: id, description: opts.description }), now);
  } catch (_) {
    // Events table may not exist in test contexts — ignore
  }

  return { id, source, description: opts.description, createdAt: now };
}

export function recordEntityChange(
  db: SQLiteDatabase,
  changesetId: string,
  entityId: string,
  action: ChangeAction,
  beforeData?: Record<string, unknown> | null,
  afterData?: Record<string, unknown> | null,
): EntityChange {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO entity_changes (id, changeset_id, entity_id, action, before_data, after_data)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, changesetId, entityId, action, beforeData ? JSON.stringify(beforeData) : null, afterData ? JSON.stringify(afterData) : null);

  return { id, changesetId, entityId, action, beforeData: beforeData ?? null, afterData: afterData ?? null };
}

export function recordRelationChange(
  db: SQLiteDatabase,
  changesetId: string,
  relationId: string,
  action: ChangeAction,
  beforeData?: Record<string, unknown> | null,
  afterData?: Record<string, unknown> | null,
): RelationChange {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO relation_changes (id, changeset_id, relation_id, action, before_data, after_data)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, changesetId, relationId, action, beforeData ? JSON.stringify(beforeData) : null, afterData ? JSON.stringify(afterData) : null);

  return { id, changesetId, relationId, action, beforeData: beforeData ?? null, afterData: afterData ?? null };
}

// ── Queries ─────────────────────────────────

export function getChangeset(db: SQLiteDatabase, id: string): Changeset | null {
  const row = db.prepare(`SELECT * FROM changesets WHERE id = ?`).get(id);
  return row ? rowToChangeset(row) : null;
}

export function getEntityHistory(db: SQLiteDatabase, entityId: string): EntityChange[] {
  return (db.prepare(
    `SELECT ec.* FROM entity_changes ec
     JOIN changesets c ON ec.changeset_id = c.id
     WHERE ec.entity_id = ?
     ORDER BY c.created_at`
  ).all(entityId) as any[]).map(rowToEntityChange);
}

export function getRelationHistory(db: SQLiteDatabase, relationId: string): RelationChange[] {
  return (db.prepare(
    `SELECT rc.* FROM relation_changes rc
     JOIN changesets c ON rc.changeset_id = c.id
     WHERE rc.relation_id = ?
     ORDER BY c.created_at`
  ).all(relationId) as any[]).map(rowToRelationChange);
}

export function getChangesetChanges(db: SQLiteDatabase, changesetId: string): {
  entityChanges: EntityChange[];
  relationChanges: RelationChange[];
} {
  const entityChanges = (db.prepare(
    `SELECT * FROM entity_changes WHERE changeset_id = ?`
  ).all(changesetId) as any[]).map(rowToEntityChange);

  const relationChanges = (db.prepare(
    `SELECT * FROM relation_changes WHERE changeset_id = ?`
  ).all(changesetId) as any[]).map(rowToRelationChange);

  return { entityChanges, relationChanges };
}
