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

/** Whether sqlite-vec extension is loaded. */
let _vecAvailable: boolean | null = null;

/**
 * Attempt to load sqlite-vec extension. Call once at startup.
 * Fail-open: returns false if extension not available.
 */
export function loadSqliteVec(db: SQLiteDatabase): boolean {
  if (_vecAvailable !== null) return _vecAvailable;

  try {
    // sqlite-vec provides vec0 virtual table module
    // Try loading the extension — path varies by platform
    const paths = [
      "vec0",                    // In system path
      "./vec0",                  // Current directory
      "../lib/vec0",             // Bundled
    ];

    for (const p of paths) {
      try {
        db.exec(`SELECT load_extension('${p}')`);
        _vecAvailable = true;
        break;
      } catch {
        continue;
      }
    }

    if (!_vecAvailable) {
      // Try if vec0 is already compiled in (some builds include it)
      try {
        db.exec("SELECT vec_version()");
        _vecAvailable = true;
      } catch {
        _vecAvailable = false;
      }
    }

    if (_vecAvailable) {
      // Create vector index table if it doesn't exist
      const existing = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='entities_vec'"
      ).get();

      if (!existing) {
        db.exec(`
          CREATE VIRTUAL TABLE entities_vec USING vec0(
            entity_id TEXT PRIMARY KEY,
            embedding float[384]
          );
        `);
      }
    }

    return _vecAvailable;
  } catch {
    _vecAvailable = false;
    return false;
  }
}

/**
 * Check if sqlite-vec is available without attempting to load.
 */
export function isVecAvailable(): boolean {
  return _vecAvailable === true;
}

/**
 * Search entities by semantic similarity using sqlite-vec.
 * Requires embeddings to be stored in entities_vec table.
 *
 * @param db - SQLite database handle
 * @param embedding - Query embedding (384-dim float32 array)
 * @param opts - Optional filters
 */
export function searchSemantic(
  db: SQLiteDatabase,
  embedding: Float32Array,
  opts: SearchOptions = {},
): EntityRow[] {
  if (!_vecAvailable) return [];

  const limit = opts.limit ?? 10;

  try {
    // sqlite-vec uses MATCH with a blob for KNN search
    const embeddingBlob = Buffer.from(embedding.buffer);

    let sql = `
      SELECT e.*, v.distance
      FROM entities_vec v
      JOIN entities e ON e.id = v.entity_id
      WHERE v.embedding MATCH ?
    `;
    const params: unknown[] = [embeddingBlob];

    if (opts.type) {
      sql += " AND e.type = ?";
      params.push(opts.type);
    }
    if (opts.projectId) {
      sql += " AND e.project_id = ?";
      params.push(opts.projectId);
    }

    sql += " ORDER BY v.distance LIMIT ?";
    params.push(limit);

    return db.prepare(sql).all(...params) as EntityRow[];
  } catch (err) {
    console.warn(`[graph-search] Semantic search failed: ${(err as Error).message}`);
    return [];
  }
}

/**
 * Store an embedding for an entity in the vector index.
 *
 * @param db - SQLite database handle
 * @param entityId - Entity ID to associate
 * @param embedding - 384-dim float32 embedding
 */
export function storeEmbedding(
  db: SQLiteDatabase,
  entityId: string,
  embedding: Float32Array,
): boolean {
  if (!_vecAvailable) return false;

  try {
    const blob = Buffer.from(embedding.buffer);
    db.prepare(
      "INSERT OR REPLACE INTO entities_vec (entity_id, embedding) VALUES (?, ?)"
    ).run(entityId, blob);
    return true;
  } catch (err) {
    console.warn(`[graph-search] Store embedding failed: ${(err as Error).message}`);
    return false;
  }
}

// ── Hybrid Search ───────────────────────────────

/**
 * Combined search: keyword + semantic, deduplicated and ranked.
 * Semantic results are included only if sqlite-vec is available.
 */
export function searchHybrid(
  db: SQLiteDatabase,
  query: string,
  embedding: Float32Array | null,
  opts: SearchOptions = {},
): EntityRow[] {
  const limit = opts.limit ?? 10;

  // Keyword results
  const kwResults = searchKeyword(db, query, { ...opts, limit });

  // Semantic results (if available)
  let vecResults: EntityRow[] = [];
  if (embedding && _vecAvailable) {
    vecResults = searchSemantic(db, embedding, { ...opts, limit });
  }

  // Merge and deduplicate (keyword results first, then semantic)
  const seen = new Set<string>();
  const merged: EntityRow[] = [];

  for (const r of kwResults) {
    if (!seen.has(r.id)) {
      seen.add(r.id);
      merged.push(r);
    }
  }
  for (const r of vecResults) {
    if (!seen.has(r.id)) {
      seen.add(r.id);
      merged.push(r);
    }
  }

  return merged.slice(0, limit);
}
