/**
 * Graph Search — FTS5 keyword + sqlite-vec semantic search (v0.6.5 GRAPH FR-2,3).
 *
 * Two search modes:
 *   1. Keyword (FTS5): fast, exact-ish matching. Always available.
 *   2. Semantic (sqlite-vec): cosine similarity on embeddings. Fail-open to FTS5.
 *
 * All functions take a raw SQLiteDatabase handle (from store.getDb()).
 */

import type { SQLiteDatabase } from "./sqlite-adapter.js";

// ── Types ───────────────────────────────────────

export interface EntityRow {
  id: string;
  type: string;
  title: string;
  description: string | null;
  status: string;
  metadata: string;
  project_id: string | null;
  created_at: number;
  updated_at: number;
  /** FTS5 rank score (lower = better match). Only set for keyword search. */
  rank?: number;
  /** Vector distance (lower = closer). Only set for semantic search. */
  distance?: number;
}

export interface SearchOptions {
  type?: string;
  projectId?: string;
  status?: string;
  limit?: number;
}

// ── FTS5 Keyword Search ─────────────────────────

/**
 * Search entities by keyword using FTS5 full-text index.
 * Returns results ranked by relevance (BM25).
 *
 * @param db - SQLite database handle
 * @param query - Search query (FTS5 syntax: AND/OR/NOT, "phrase", prefix*)
 * @param opts - Optional filters
 */
export function searchKeyword(
  db: SQLiteDatabase,
  query: string,
  opts: SearchOptions = {},
): EntityRow[] {
  const limit = opts.limit ?? 10;

  // Sanitize query: escape special FTS5 characters, add implicit prefix match
  const sanitized = sanitizeFTS5Query(query);
  if (!sanitized) return [];

  try {
    let sql = `
      SELECT e.*, fts.rank
      FROM entities_fts fts
      JOIN entities e ON e.rowid = fts.rowid
      WHERE entities_fts MATCH ?
    `;
    const params: unknown[] = [sanitized];

    if (opts.type) {
      sql += " AND e.type = ?";
      params.push(opts.type);
    }
    if (opts.projectId) {
      sql += " AND e.project_id = ?";
      params.push(opts.projectId);
    }
    if (opts.status) {
      sql += " AND e.status = ?";
      params.push(opts.status);
    }

    sql += " ORDER BY fts.rank LIMIT ?";
    params.push(limit);

    return db.prepare(sql).all(...params) as EntityRow[];
  } catch (err) {
    // FTS5 not available or query syntax error — fallback to LIKE
    return searchLikeFallback(db, query, opts);
  }
}

/**
 * Sanitize a user query for FTS5 MATCH.
 * - Strips dangerous operators
 * - Adds implicit OR between terms for natural search
 */
function sanitizeFTS5Query(query: string): string {
  // Remove FTS5 column filters and potentially dangerous syntax
  let clean = query
    .replace(/[{}()\[\]^~]/g, " ")  // remove special chars
    .replace(/\s+/g, " ")           // collapse whitespace
    .trim();

  if (!clean) return "";

  // If user didn't use explicit operators, add implicit prefix match
  if (!/\b(AND|OR|NOT|NEAR)\b/.test(clean) && !clean.includes('"')) {
    // Add * suffix for prefix matching on each token
    clean = clean
      .split(" ")
      .filter(t => t.length > 0)
      .map(t => `"${t}"*`)
      .join(" OR ");
  }

  return clean;
}

/**
 * Fallback: LIKE-based search when FTS5 is unavailable.
 */
function searchLikeFallback(
  db: SQLiteDatabase,
  query: string,
  opts: SearchOptions,
): EntityRow[] {
  const limit = opts.limit ?? 10;
  const pattern = `%${query}%`;

  let sql = `
    SELECT * FROM entities
    WHERE (title LIKE ? OR description LIKE ?)
  `;
  const params: unknown[] = [pattern, pattern];

  if (opts.type) {
    sql += " AND type = ?";
    params.push(opts.type);
  }
  if (opts.projectId) {
    sql += " AND project_id = ?";
    params.push(opts.projectId);
  }
  if (opts.status) {
    sql += " AND status = ?";
    params.push(opts.status);
  }

  sql += " ORDER BY updated_at DESC LIMIT ?";
  params.push(limit);

  return db.prepare(sql).all(...params) as EntityRow[];
}

// ── sqlite-vec Semantic Search ──────────────────

// ── Hybrid Search ───────────────────────────────
// NOTE: Semantic vector search moved to vault/search.ts (BGE-M3 1024-dim + RRF).
// This file retains keyword-only search for legacy memory_* MCP tools.

/**
 * Combined search: keyword results deduplicated and ranked.
 */
export function searchHybrid(
  db: SQLiteDatabase,
  query: string,
  _embedding: Float32Array | null,
  opts: SearchOptions = {},
): EntityRow[] {
  // Semantic search removed — use vault/search.ts for vector+RRF search.
  // This function now delegates to keyword-only search.
  return searchKeyword(db, query, opts);
}
