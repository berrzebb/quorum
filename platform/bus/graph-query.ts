/**
 * Graph Query — edge-based traversal for Knowledge Graph (v0.6.5 GRAPH FR-4).
 *
 * Replaces dedicated RTM, dependency-graph, and blast-radius tools
 * with unified graph queries on the entities + relations tables.
 *
 * All queries are plain SQL on existing tables — no new schema needed.
 */

import type { SQLiteDatabase } from "./sqlite-adapter.js";
import type { EntityRow } from "./graph-search.js";

// ── Types ───────────────────────────────────────

export interface TraversalOptions {
  /** Edge type filter (e.g., "imports", "implements", "tested-by"). */
  edgeType?: string;
  /** Max traversal depth for recursive queries. Default: 10. */
  maxDepth?: number;
  /** Max results. Default: 50. */
  limit?: number;
}

export interface RTMTrace {
  fr: EntityRow;
  files: EntityRow[];
  tests: EntityRow[];
}

export interface AgentTrust {
  agentId: string;
  total: number;
  correct: number;
  incorrect: number;
  trustPct: number;
}

// ── Forward Traversal (Dependency) ──────────────

/**
 * Forward edge traversal: find all entities reachable FROM a given node.
 * Use case: "what does file.ts depend on?" → queryForward("file.ts", "imports")
 *
 * Single-hop by default. For multi-hop, use recursive variant.
 */
export function queryForward(
  db: SQLiteDatabase,
  fromId: string,
  opts: TraversalOptions = {},
): EntityRow[] {
  const limit = opts.limit ?? 50;

  let sql: string;
  const params: unknown[] = [];

  if (opts.edgeType) {
    sql = `
      SELECT e.* FROM relations r
      JOIN entities e ON e.id = r.to_id
      WHERE r.from_id = ? AND r.type = ?
      ORDER BY r.weight DESC, e.updated_at DESC
      LIMIT ?
    `;
    params.push(fromId, opts.edgeType, limit);
  } else {
    sql = `
      SELECT e.* FROM relations r
      JOIN entities e ON e.id = r.to_id
      WHERE r.from_id = ?
      ORDER BY r.weight DESC, e.updated_at DESC
      LIMIT ?
    `;
    params.push(fromId, limit);
  }

  return db.prepare(sql).all(...params) as EntityRow[];
}

// ── Reverse Traversal (Blast Radius) ────────────

/**
 * Reverse edge traversal: find all entities that depend ON a given node.
 * Use case: "what breaks if I change file.ts?" → queryReverse("file.ts", "imports")
 *
 * Uses recursive CTE for multi-hop traversal with depth limiting.
 */
export function queryReverse(
  db: SQLiteDatabase,
  toId: string,
  opts: TraversalOptions = {},
): EntityRow[] {
  const maxDepth = opts.maxDepth ?? 10;
  const limit = opts.limit ?? 50;

  if (opts.edgeType) {
    const sql = `
      WITH RECURSIVE impact(id, depth) AS (
        SELECT r.from_id, 1 FROM relations r
        WHERE r.to_id = ? AND r.type = ?
        UNION ALL
        SELECT r2.from_id, i.depth + 1 FROM relations r2
        JOIN impact i ON r2.to_id = i.id
        WHERE r2.type = ? AND i.depth < ?
      )
      SELECT DISTINCT e.* FROM impact i
      JOIN entities e ON e.id = i.id
      LIMIT ?
    `;
    return db.prepare(sql).all(toId, opts.edgeType, opts.edgeType, maxDepth, limit) as EntityRow[];
  }

  // No edge type filter — traverse all edge types
  const sql = `
    WITH RECURSIVE impact(id, depth) AS (
      SELECT r.from_id, 1 FROM relations r
      WHERE r.to_id = ?
      UNION ALL
      SELECT r2.from_id, i.depth + 1 FROM relations r2
      JOIN impact i ON r2.to_id = i.id
      WHERE i.depth < ?
    )
    SELECT DISTINCT e.* FROM impact i
    JOIN entities e ON e.id = i.id
    LIMIT ?
  `;
  return db.prepare(sql).all(toId, maxDepth, limit) as EntityRow[];
}

// ── RTM Trace ───────────────────────────────────

/**
 * Trace Requirements Traceability Matrix path:
 *   FR → implements → File → tested-by → Test
 *
 * Replaces rtm_parse + rtm_merge MCP tools.
 */
export function traceRTM(
  db: SQLiteDatabase,
  frId: string,
): RTMTrace | null {
  // Get the FR entity
  const fr = db.prepare("SELECT * FROM entities WHERE id = ?").get(frId) as EntityRow | undefined;
  if (!fr) return null;

  // FR → implements → File
  const files = db.prepare(`
    SELECT e.* FROM relations r
    JOIN entities e ON e.id = r.to_id
    WHERE r.from_id = ? AND r.type = 'implements'
    ORDER BY e.title
  `).all(frId) as EntityRow[];

  // File → tested-by → Test (for all files)
  const tests: EntityRow[] = [];
  const seenTests = new Set<string>();

  for (const file of files) {
    const fileTests = db.prepare(`
      SELECT e.* FROM relations r
      JOIN entities e ON e.id = r.to_id
      WHERE r.from_id = ? AND r.type = 'tested-by'
      ORDER BY e.title
    `).all(file.id) as EntityRow[];

    for (const t of fileTests) {
      if (!seenTests.has(t.id)) {
        seenTests.add(t.id);
        tests.push(t);
      }
    }
  }

  return { fr, files, tests };
}

// ── Pattern History ─────────────────────────────

/**
 * Query past failure patterns related to a file or pattern string.
 * Used by memory_recall to inject past context into audit prompts.
 */
export function queryPatternHistory(
  db: SQLiteDatabase,
  fileOrPattern: string,
  limit = 5,
): EntityRow[] {
  // Method 1: Direct edge lookup (file → caused → Pattern)
  const byEdge = db.prepare(`
    SELECT e.* FROM relations r
    JOIN entities e ON e.id = r.from_id
    WHERE r.to_id = ? AND r.type = 'caused' AND e.type = 'Pattern'
    ORDER BY e.created_at DESC
    LIMIT ?
  `).all(fileOrPattern, limit) as EntityRow[];

  if (byEdge.length > 0) return byEdge;

  // Method 2: FTS5 search on Pattern nodes (file name in content)
  try {
    const sanitized = fileOrPattern.replace(/[^a-zA-Z0-9._/-]/g, " ").trim();
    if (!sanitized) return [];

    return db.prepare(`
      SELECT e.* FROM entities_fts fts
      JOIN entities e ON e.rowid = fts.rowid
      WHERE entities_fts MATCH ? AND e.type = 'Pattern'
      ORDER BY fts.rank
      LIMIT ?
    `).all(`"${sanitized}"`, limit) as EntityRow[];
  } catch {
    // FTS5 not available — LIKE fallback
    return db.prepare(`
      SELECT * FROM entities
      WHERE type = 'Pattern' AND (title LIKE ? OR description LIKE ?)
      ORDER BY created_at DESC
      LIMIT ?
    `).all(`%${fileOrPattern}%`, `%${fileOrPattern}%`, limit) as EntityRow[];
  }
}

// ── Agent Trust Score ───────────────────────────

/**
 * Calculate agent trust score from completion history.
 *
 * Data source: relations edges
 *   agent → completed-correctly → session   (audit passed after completion)
 *   agent → completed-incorrectly → session (audit rejected after completion)
 *
 * New agents (no history) get 100% trust — no suspicion by default.
 */
export function queryAgentTrust(
  db: SQLiteDatabase,
  agentId: string,
): AgentTrust {
  const row = db.prepare(`
    SELECT
      COUNT(*) AS total,
      COUNT(CASE WHEN type = 'completed-correctly' THEN 1 END) AS correct,
      COUNT(CASE WHEN type = 'completed-incorrectly' THEN 1 END) AS incorrect
    FROM relations
    WHERE from_id = ? AND type IN ('completed-correctly', 'completed-incorrectly')
  `).get(agentId) as { total: number; correct: number; incorrect: number };

  const total = row.total || 0;
  const correct = row.correct || 0;
  const incorrect = row.incorrect || 0;
  const trustPct = total === 0 ? 100 : Math.round((correct / total) * 100);

  return { agentId, total, correct, incorrect, trustPct };
}

// ── Node CRUD ───────────────────────────────────

export interface AddNodeInput {
  id?: string;
  type: string;
  title: string;
  description?: string;
  status?: string;
  metadata?: Record<string, unknown>;
  projectId?: string;
}

export interface AddEdgeInput {
  fromId: string;
  toId: string;
  type: string;
  weight?: number;
  metadata?: Record<string, unknown>;
}

/**
 * Add a node (entity) to the knowledge graph.
 * Returns the node ID.
 */
export function addNode(db: SQLiteDatabase, input: AddNodeInput): string {
  const id = input.id ?? `${input.type.toLowerCase()}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const now = Date.now();

  db.prepare(`
    INSERT OR IGNORE INTO entities (id, type, title, description, status, metadata, project_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.type,
    input.title,
    input.description ?? null,
    input.status ?? "active",
    JSON.stringify(input.metadata ?? {}),
    input.projectId ?? null,
    now, now,
  );

  return id;
}

/**
 * Update a node's fields. Only non-undefined fields are updated.
 */
export function updateNode(
  db: SQLiteDatabase,
  id: string,
  updates: Partial<Pick<AddNodeInput, "title" | "description" | "status" | "metadata" | "projectId">>,
): boolean {
  const sets: string[] = [];
  const params: unknown[] = [];

  if (updates.title !== undefined) { sets.push("title = ?"); params.push(updates.title); }
  if (updates.description !== undefined) { sets.push("description = ?"); params.push(updates.description); }
  if (updates.status !== undefined) { sets.push("status = ?"); params.push(updates.status); }
  if (updates.metadata !== undefined) { sets.push("metadata = ?"); params.push(JSON.stringify(updates.metadata)); }
  if (updates.projectId !== undefined) { sets.push("project_id = ?"); params.push(updates.projectId); }

  if (sets.length === 0) return false;

  sets.push("updated_at = ?");
  params.push(Date.now());
  params.push(id);

  const result = db.prepare(`UPDATE entities SET ${sets.join(", ")} WHERE id = ?`).run(...params);
  return (result as { changes: number }).changes > 0;
}

/**
 * Query nodes with filters.
 */
export function queryNodes(
  db: SQLiteDatabase,
  filter: { type?: string; status?: string; projectId?: string; limit?: number } = {},
): EntityRow[] {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filter.type) { conditions.push("type = ?"); params.push(filter.type); }
  if (filter.status) { conditions.push("status = ?"); params.push(filter.status); }
  if (filter.projectId) { conditions.push("project_id = ?"); params.push(filter.projectId); }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = filter.limit ?? 100;

  return db.prepare(
    `SELECT * FROM entities ${where} ORDER BY updated_at DESC LIMIT ?`
  ).all(...params, limit) as EntityRow[];
}

/**
 * Add an edge (relation) between two nodes.
 * Returns the edge ID.
 */
export function addEdge(db: SQLiteDatabase, input: AddEdgeInput): string {
  const id = `rel-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  db.prepare(`
    INSERT OR IGNORE INTO relations (id, from_id, to_id, type, weight, metadata, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.fromId,
    input.toId,
    input.type,
    input.weight ?? 1.0,
    JSON.stringify(input.metadata ?? {}),
    Date.now(),
  );

  return id;
}

/**
 * Query edges with filters.
 */
export function queryEdges(
  db: SQLiteDatabase,
  filter: { fromId?: string; toId?: string; type?: string; limit?: number } = {},
): Array<{ id: string; from_id: string; to_id: string; type: string; weight: number; metadata: string; created_at: number }> {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filter.fromId) { conditions.push("from_id = ?"); params.push(filter.fromId); }
  if (filter.toId) { conditions.push("to_id = ?"); params.push(filter.toId); }
  if (filter.type) { conditions.push("type = ?"); params.push(filter.type); }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = filter.limit ?? 100;

  return db.prepare(
    `SELECT * FROM relations ${where} ORDER BY created_at DESC LIMIT ?`
  ).all(...params, limit) as Array<{ id: string; from_id: string; to_id: string; type: string; weight: number; metadata: string; created_at: number }>;
}
