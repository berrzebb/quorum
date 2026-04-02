/**
 * Graph Schema — Entity CRUD for the semantic impact graph.
 *
 * Entities are 1st-class objects (requirements, decisions, tests, etc.)
 * stored in the SQLite entities table. 12 entity types, 5 statuses.
 *
 * @module bus/graph-schema
 */

import { randomUUID } from "node:crypto";

// ── Types ────────────────────────────────────

export type EntityType =
  | 'requirement' | 'decision' | 'interface' | 'state'
  | 'crosscut' | 'question' | 'assumption' | 'criterion'
  | 'risk' | 'test' | 'plan' | 'phase';

export type EntityStatus = 'draft' | 'active' | 'deprecated' | 'resolved' | 'deleted';

export interface GraphEntity {
  id: string;
  type: EntityType;
  title: string;
  description?: string;
  status: EntityStatus;
  metadata: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

const VALID_TYPES = new Set<string>([
  'requirement', 'decision', 'interface', 'state',
  'crosscut', 'question', 'assumption', 'criterion',
  'risk', 'test', 'plan', 'phase',
]);

const VALID_STATUSES = new Set<string>([
  'draft', 'active', 'deprecated', 'resolved', 'deleted',
]);

// ── Validation ──────────────────────────────

function validateType(type: string): asserts type is EntityType {
  if (!VALID_TYPES.has(type)) {
    throw new Error(`Invalid entity type: "${type}". Valid: ${[...VALID_TYPES].join(', ')}`);
  }
}

function validateStatus(status: string): asserts status is EntityStatus {
  if (!VALID_STATUSES.has(status)) {
    throw new Error(`Invalid entity status: "${status}". Valid: ${[...VALID_STATUSES].join(', ')}`);
  }
}

// ── Database interface ──────────────────────
// Minimal interface matching better-sqlite3's Database

interface SQLiteStatement {
  run(...params: unknown[]): { changes: number };
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

interface SQLiteDatabase {
  prepare(sql: string): SQLiteStatement;
}

// ── Row → Entity conversion ─────────────────

function rowToEntity(row: any): GraphEntity {
  return {
    id: row.id,
    type: row.type as EntityType,
    title: row.title,
    description: row.description ?? undefined,
    status: row.status as EntityStatus,
    metadata: JSON.parse(row.metadata || '{}'),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ── CRUD ─────────────────────────────────────

export function addEntity(
  db: SQLiteDatabase,
  entity: { id: string; type: EntityType; title: string; description?: string; status?: EntityStatus; metadata?: Record<string, unknown> },
): GraphEntity {
  validateType(entity.type);
  const status = entity.status ?? 'draft';
  validateStatus(status);

  const now = Date.now();
  const meta = JSON.stringify(entity.metadata ?? {});

  try {
    db.prepare(
      `INSERT INTO entities (id, type, title, description, status, metadata, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(entity.id, entity.type, entity.title, entity.description ?? null, status, meta, now, now);
  } catch (err: any) {
    if (err.message?.includes('UNIQUE constraint') || err.code === 'SQLITE_CONSTRAINT_PRIMARYKEY') {
      throw new Error(`Entity already exists: "${entity.id}"`);
    }
    throw err;
  }

  return { id: entity.id, type: entity.type, title: entity.title, description: entity.description, status, metadata: entity.metadata ?? {}, createdAt: now, updatedAt: now };
}

export function getEntity(db: SQLiteDatabase, id: string): GraphEntity | null {
  const row = db.prepare(`SELECT * FROM entities WHERE id = ?`).get(id);
  return row ? rowToEntity(row) : null;
}

export function listEntities(
  db: SQLiteDatabase,
  filter?: { type?: EntityType; status?: EntityStatus },
): GraphEntity[] {
  if (filter?.type && filter?.status) {
    return (db.prepare(`SELECT * FROM entities WHERE type = ? AND status = ? ORDER BY created_at`).all(filter.type, filter.status) as any[]).map(rowToEntity);
  }
  if (filter?.type) {
    return (db.prepare(`SELECT * FROM entities WHERE type = ? ORDER BY created_at`).all(filter.type) as any[]).map(rowToEntity);
  }
  if (filter?.status) {
    return (db.prepare(`SELECT * FROM entities WHERE status = ? ORDER BY created_at`).all(filter.status) as any[]).map(rowToEntity);
  }
  return (db.prepare(`SELECT * FROM entities ORDER BY created_at`).all() as any[]).map(rowToEntity);
}

export function updateEntity(
  db: SQLiteDatabase,
  id: string,
  fields: Partial<Pick<GraphEntity, 'title' | 'description' | 'status' | 'metadata'>>,
): GraphEntity {
  const existing = getEntity(db, id);
  if (!existing) throw new Error(`Entity not found: "${id}"`);

  if (fields.status !== undefined) validateStatus(fields.status);

  const title = fields.title ?? existing.title;
  const description = fields.description !== undefined ? fields.description : existing.description;
  const status = fields.status ?? existing.status;
  const metadata = fields.metadata ? JSON.stringify(fields.metadata) : JSON.stringify(existing.metadata);
  const now = Date.now();

  db.prepare(
    `UPDATE entities SET title = ?, description = ?, status = ?, metadata = ?, updated_at = ? WHERE id = ?`
  ).run(title, description ?? null, status, metadata, now, id);

  return { ...existing, title, description, status, metadata: fields.metadata ?? existing.metadata, updatedAt: now };
}

export function deprecateEntity(db: SQLiteDatabase, id: string): GraphEntity {
  return updateEntity(db, id, { status: 'deprecated' });
}
