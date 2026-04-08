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

// ── HNSW Index (usearch) ────────────────────────

interface HNSWIndex {
  add(key: bigint, vector: Float32Array): void;
  search(query: Float32Array, k: number): { keys: BigInt64Array; distances: Float32Array };
  size(): number;
  save(path: string): void;
  load(path: string): void;
}

let _hnswIndex: HNSWIndex | null = null;
let _turnIdMap: Map<bigint, string> = new Map();
let _reverseMap: Map<string, bigint> = new Map();

/**
 * Build or rebuild HNSW index from vault store embeddings.
 */
export async function buildHNSWIndex(store: VaultStore, dimensions: number): Promise<HNSWIndex | null> {
  let usearch: any;
  try {
    // @ts-ignore — optional dependency
    usearch = await import(/* webpackIgnore: true */ "usearch");
  } catch {
    console.warn("[search] usearch not available — vector search disabled");
    return null;
  }

  const embeddings = store.getAllEmbeddings();
  if (embeddings.length === 0) return null;

  const index = new usearch.Index({
    metric: "cos",
    connectivity: 16,
    dimensions,
  });

  _turnIdMap = new Map();
  _reverseMap = new Map();

  for (let i = 0; i < embeddings.length; i++) {
    const key = BigInt(i);
    _turnIdMap.set(key, embeddings[i]!.turnId);
    _reverseMap.set(embeddings[i]!.turnId, key);
    index.add(key, embeddings[i]!.vector);
  }

  _hnswIndex = index;
  return index;
}

// ── Search Functions ────────────────────────────

/**
 * BM25 keyword search via FTS5.
 */
export function searchKeyword(store: VaultStore, query: string, limit = 20): SearchResult[] {
  return store.searchFTS(query, limit);
}

/**
 * Vector semantic search via HNSW.
 */
export async function searchSemantic(
  store: VaultStore,
  query: string,
  embedder: Embedder | null,
  limit = 20,
): Promise<SearchResult[]> {
  if (!embedder || !_hnswIndex || _hnswIndex.size() === 0) return [];

  const queryVec = await embedder.embed(query);
  const { keys, distances } = _hnswIndex.search(queryVec, limit);

  const results: SearchResult[] = [];
  for (let i = 0; i < keys.length; i++) {
    const turnId = _turnIdMap.get(keys[i]!);
    if (!turnId) continue;

    const turns = store.getTurns("", 1); // placeholder — need turn lookup
    // Direct turn lookup
    const row = store.db.prepare(`
      SELECT t.id as turnId, t.session_id as sessionId, s.provider,
             t.role, t.content, t.timestamp
      FROM turns t JOIN sessions s ON t.session_id = s.id
      WHERE t.id = ?
    `).get(turnId) as SearchResult | undefined;

    if (row) {
      results.push({ ...row, score: 1 - (distances[i] ?? 0) }); // cosine similarity
    }
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
