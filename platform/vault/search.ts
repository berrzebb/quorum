/**
 * Vault Search — hybrid BM25 + vector search with Reciprocal Rank Fusion.
 *
 * Three search modes:
 * - keyword: FTS5 BM25 only
 * - semantic: BGE-M3 vector + HNSW ANN only
 * - hybrid: RRF(k=60) combining both (default)
 *
 * Fail-open: if embeddings unavailable, falls back to keyword-only.
 */

import type { VaultStore, SearchResult } from "./store.js";
import type { Embedder } from "./embedder.js";

// ── Types ───────────────────────────────────────

export interface SearchOptions {
  mode?: "keyword" | "semantic" | "hybrid";
  provider?: string;   // filter by provider
  limit?: number;      // max results (default 20)
  sessionId?: string;  // filter by session
}

export interface HybridResult extends SearchResult {
  bm25Rank?: number;
  vecRank?: number;
  rrfScore: number;
}

// ── In-Memory Vector Index ──────────────────────
// Brute-force cosine similarity — fast enough for <100k vectors at <1ms.

let _vecIndex: Array<{ turnId: string; vector: Float32Array }> | null = null;

/**
 * Build in-memory vector index from vault store embeddings.
 */
export function buildVectorIndex(store: VaultStore): number {
  _vecIndex = store.getAllEmbeddings();
  return _vecIndex.length;
}

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i]! * b[i]!;
  return dot; // vectors are L2-normalized, so dot = cosine
}

// ── Search Functions ────────────────────────────

/**
 * BM25 keyword search via FTS5.
 */
export function searchKeyword(store: VaultStore, query: string, limit = 20): SearchResult[] {
  return store.searchFTS(query, limit);
}

/**
 * Vector semantic search via brute-force cosine similarity.
 */
export async function searchSemantic(
  store: VaultStore,
  query: string,
  embedder: Embedder | null,
  limit = 20,
): Promise<SearchResult[]> {
  if (!embedder || !_vecIndex || _vecIndex.length === 0) return [];

  const queryVec = await embedder.embed(query);

  // Brute-force top-k by cosine similarity
  const scored = _vecIndex.map(e => ({
    turnId: e.turnId,
    score: cosineSimilarity(queryVec, e.vector),
  }));
  scored.sort((a, b) => b.score - a.score);
  const topK = scored.slice(0, limit);

  const stmtTurn = store.db.prepare(`
    SELECT t.id as turnId, t.session_id as sessionId, s.provider,
           t.role, t.content, t.timestamp
    FROM turns t JOIN sessions s ON t.session_id = s.id
    WHERE t.id = ?
  `);

  const results: SearchResult[] = [];
  for (const { turnId, score } of topK) {
    const row = stmtTurn.get(turnId) as SearchResult | undefined;
    if (row) results.push({ ...row, score });
  }

  return results;
}

/**
 * Hybrid search using Reciprocal Rank Fusion (RRF).
 *
 * RRF score = sum(1 / (k + rank_i)) for each result list
 * k = 60 (standard constant)
 */
export async function searchHybrid(
  store: VaultStore,
  query: string,
  embedder: Embedder | null,
  opts: SearchOptions = {},
): Promise<HybridResult[]> {
  const limit = opts.limit ?? 20;
  const fetchLimit = limit * 3; // fetch more for fusion

  const mode = opts.mode ?? "hybrid";

  if (mode === "keyword") {
    return searchKeyword(store, query, limit).map((r, i) => ({
      ...r, bm25Rank: i, rrfScore: 1 / (60 + i),
    }));
  }

  if (mode === "semantic") {
    const vecResults = await searchSemantic(store, query, embedder, limit);
    return vecResults.map((r, i) => ({
      ...r, vecRank: i, rrfScore: 1 / (60 + i),
    }));
  }

  // Hybrid: RRF fusion
  const K = 60;
  const bm25Results = searchKeyword(store, query, fetchLimit);
  const vecResults = await searchSemantic(store, query, embedder, fetchLimit);

  // Build score map
  const scoreMap = new Map<string, { result: SearchResult; bm25Rank?: number; vecRank?: number; rrfScore: number }>();

  for (let i = 0; i < bm25Results.length; i++) {
    const r = bm25Results[i]!;
    const existing = scoreMap.get(r.turnId);
    const rrfContrib = 1 / (K + i);
    if (existing) {
      existing.bm25Rank = i;
      existing.rrfScore += rrfContrib;
    } else {
      scoreMap.set(r.turnId, { result: r, bm25Rank: i, rrfScore: rrfContrib });
    }
  }

  for (let i = 0; i < vecResults.length; i++) {
    const r = vecResults[i]!;
    const existing = scoreMap.get(r.turnId);
    const rrfContrib = 1 / (K + i);
    if (existing) {
      existing.vecRank = i;
      existing.rrfScore += rrfContrib;
    } else {
      scoreMap.set(r.turnId, { result: r, vecRank: i, rrfScore: rrfContrib });
    }
  }

  // Sort by RRF score (descending)
  const fused = [...scoreMap.values()]
    .sort((a, b) => b.rrfScore - a.rrfScore)
    .slice(0, limit);

  // Apply provider filter
  return fused
    .filter(f => !opts.provider || f.result.provider === opts.provider)
    .map(f => ({
      ...f.result,
      bm25Rank: f.bm25Rank,
      vecRank: f.vecRank,
      rrfScore: f.rrfScore,
    }));
}
