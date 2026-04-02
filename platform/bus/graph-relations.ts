/**
 * Graph Relations — typed edges between entities with allowed edge matrix.
 *
 * 17 relation types in 3 layers: arch (12), exec (3), mapping (2).
 * Each relation type has an allowed edge matrix defining valid
 * (source type, target type) pairs. Self-loops are always rejected.
 *
 * @module bus/graph-relations
 */

import { randomUUID } from "node:crypto";
import type { EntityType } from "./graph-schema.js";
import { getEntity } from "./graph-schema.js";

// ── Types ────────────────────────────────────

export type RelationType =
  // arch (12)
  | 'refines' | 'depends_on' | 'conflicts_with' | 'extends'
  | 'constrains' | 'addresses' | 'derives_from' | 'traces_to'
  | 'satisfies' | 'decomposes' | 'cross_cuts' | 'questions'
  // exec (3)
  | 'implements' | 'verifies' | 'covers'
  // mapping (2)
  | 'maps_to' | 'validates_against';

export interface GraphRelation {
  id: string;
  fromId: string;
  toId: string;
  type: RelationType;
  weight: number;
  metadata: Record<string, unknown>;
  createdAt: number;
}

// ── Allowed Edge Matrix ─────────────────────

interface EdgeRule { from: EntityType; to: EntityType }

export const ALLOWED_EDGES: Record<RelationType, EdgeRule[]> = {
  refines:         [{ from: 'requirement', to: 'requirement' }, { from: 'criterion', to: 'requirement' }],
  depends_on:      [{ from: 'requirement', to: 'requirement' }, { from: 'plan', to: 'plan' }, { from: 'phase', to: 'phase' }],
  conflicts_with:  [{ from: 'decision', to: 'decision' }, { from: 'requirement', to: 'requirement' }],
  extends:         [{ from: 'requirement', to: 'requirement' }, { from: 'interface', to: 'interface' }],
  constrains:      [{ from: 'requirement', to: 'requirement' }, { from: 'criterion', to: 'requirement' }, { from: 'criterion', to: 'decision' }],
  addresses:       [{ from: 'decision', to: 'risk' }, { from: 'decision', to: 'question' }],
  derives_from:    [{ from: 'requirement', to: 'requirement' }, { from: 'requirement', to: 'decision' }, { from: 'decision', to: 'assumption' }],
  traces_to:       [{ from: 'plan', to: 'requirement' }, { from: 'test', to: 'requirement' }],
  satisfies:       [{ from: 'plan', to: 'criterion' }, { from: 'test', to: 'criterion' }],
  decomposes:      [{ from: 'requirement', to: 'requirement' }, { from: 'phase', to: 'plan' }],
  cross_cuts:      [{ from: 'crosscut', to: 'requirement' }, { from: 'crosscut', to: 'interface' }, { from: 'crosscut', to: 'decision' }],
  questions:       [{ from: 'question', to: 'decision' }, { from: 'question', to: 'requirement' }, { from: 'question', to: 'assumption' }],
  implements:      [{ from: 'plan', to: 'requirement' }, { from: 'plan', to: 'interface' }],
  verifies:        [{ from: 'test', to: 'requirement' }, { from: 'test', to: 'interface' }],
  covers:          [{ from: 'test', to: 'plan' }],
  maps_to:         [{ from: 'requirement', to: 'plan' }, { from: 'requirement', to: 'test' }, { from: 'decision', to: 'plan' }],
  validates_against: [{ from: 'decision', to: 'criterion' }, { from: 'plan', to: 'criterion' }],
};

const VALID_RELATION_TYPES = new Set<string>(Object.keys(ALLOWED_EDGES));

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

function rowToRelation(row: any): GraphRelation {
  return {
    id: row.id,
    fromId: row.from_id,
    toId: row.to_id,
    type: row.type as RelationType,
    weight: row.weight,
    metadata: JSON.parse(row.metadata || '{}'),
    createdAt: row.created_at,
  };
}

// ── CRUD ─────────────────────────────────────

export function addRelation(
  db: SQLiteDatabase,
  relation: { fromId: string; toId: string; type: RelationType; weight?: number; metadata?: Record<string, unknown> },
): GraphRelation {
  // Validate relation type
  if (!VALID_RELATION_TYPES.has(relation.type)) {
    throw new Error(`Invalid relation type: "${relation.type}"`);
  }

  // Self-loop check
  if (relation.fromId === relation.toId) {
    throw new Error(`Self-loop not allowed: "${relation.fromId}" → "${relation.fromId}"`);
  }

  // Verify entities exist
  const fromEntity = getEntity(db, relation.fromId);
  if (!fromEntity) throw new Error(`Source entity not found: "${relation.fromId}"`);
  const toEntity = getEntity(db, relation.toId);
  if (!toEntity) throw new Error(`Target entity not found: "${relation.toId}"`);

  // Allowed edge matrix check
  const rules = ALLOWED_EDGES[relation.type]!;
  const allowed = rules.some(r => r.from === fromEntity.type && r.to === toEntity.type);
  if (!allowed) {
    throw new Error(
      `Edge not allowed: ${fromEntity.type}→${toEntity.type} via "${relation.type}". ` +
      `Allowed: ${rules.map(r => `${r.from}→${r.to}`).join(', ')}`
    );
  }

  const id = randomUUID();
  const now = Date.now();
  const meta = JSON.stringify(relation.metadata ?? {});
  const weight = relation.weight ?? 1.0;

  db.prepare(
    `INSERT INTO relations (id, from_id, to_id, type, weight, metadata, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(id, relation.fromId, relation.toId, relation.type, weight, meta, now);

  return { id, fromId: relation.fromId, toId: relation.toId, type: relation.type, weight, metadata: relation.metadata ?? {}, createdAt: now };
}

export function getRelations(
  db: SQLiteDatabase,
  entityId: string,
  direction: 'from' | 'to' | 'both' = 'both',
): GraphRelation[] {
  if (direction === 'from') {
    return (db.prepare(`SELECT * FROM relations WHERE from_id = ? ORDER BY created_at`).all(entityId) as any[]).map(rowToRelation);
  }
  if (direction === 'to') {
    return (db.prepare(`SELECT * FROM relations WHERE to_id = ? ORDER BY created_at`).all(entityId) as any[]).map(rowToRelation);
  }
  return (db.prepare(`SELECT * FROM relations WHERE from_id = ? OR to_id = ? ORDER BY created_at`).all(entityId, entityId) as any[]).map(rowToRelation);
}

export function removeRelation(db: SQLiteDatabase, relationId: string): boolean {
  const result = db.prepare(`DELETE FROM relations WHERE id = ?`).run(relationId);
  return result.changes > 0;
}

export function getRelationsByType(db: SQLiteDatabase, type: RelationType): GraphRelation[] {
  return (db.prepare(`SELECT * FROM relations WHERE type = ? ORDER BY created_at`).all(type) as any[]).map(rowToRelation);
}
