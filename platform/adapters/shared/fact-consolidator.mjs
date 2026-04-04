/**
 * Fact Consolidator — merges, promotes, and archives facts.
 *
 * PRD § FR-11: session-start에서 중복 병합, 빈도 기반 승격, stale archive.
 * PRD § FR-14: 2+ 프로젝트에서 동일 fact → global scope로 승격.
 *
 * @module adapters/shared/fact-consolidator
 */

/**
 * @typedef {Object} ConsolidationResult
 * @property {number} merged - Duplicate facts merged
 * @property {number} promoted - Facts promoted to established
 * @property {number} archived - Stale facts archived
 * @property {number} globalPromoted - Facts promoted to global scope
 */

const PROMOTION_THRESHOLD = 3;       // frequency >= 3 → established
const ARCHIVE_AGE_MS = 30 * 86400_000; // 30 days
const SIMILARITY_THRESHOLD = 0.8;     // token overlap for dedup

/**
 * Simple token-overlap similarity (Jaccard-like).
 * @param {string} a
 * @param {string} b
 * @returns {number} 0.0-1.0
 */
function tokenSimilarity(a, b) {
  const tokensA = new Set(a.toLowerCase().split(/\s+/).filter(t => t.length > 2));
  const tokensB = new Set(b.toLowerCase().split(/\s+/).filter(t => t.length > 2));
  if (tokensA.size === 0 && tokensB.size === 0) return 1.0;
  if (tokensA.size === 0 || tokensB.size === 0) return 0.0;
  let overlap = 0;
  for (const t of tokensA) if (tokensB.has(t)) overlap++;
  return overlap / Math.max(tokensA.size, tokensB.size);
}

/**
 * Consolidate facts for a project.
 *
 * @param {object} store - EventStore instance (with fact CRUD methods)
 * @param {string} [projectId] - Project identifier
 * @returns {ConsolidationResult}
 */
export function consolidateFacts(store, projectId) {
  let merged = 0;
  let promoted = 0;

  // 1. Merge similar candidates
  const candidates = store.getFacts({ status: "candidate", projectId });
  const toDelete = new Set();

  for (let i = 0; i < candidates.length; i++) {
    if (toDelete.has(candidates[i].id)) continue;
    for (let j = i + 1; j < candidates.length; j++) {
      if (toDelete.has(candidates[j].id)) continue;
      if (tokenSimilarity(candidates[i].content, candidates[j].content) >= SIMILARITY_THRESHOLD) {
        // Merge j into i: add frequencies, archive j
        const mergedFreq = candidates[i].frequency + candidates[j].frequency;
        store.db?.prepare?.("UPDATE facts SET frequency = ?, updated_at = ? WHERE id = ?")
          ?.run(mergedFreq, Date.now(), candidates[i].id);
        store.promoteFact(candidates[j].id, "archived");
        candidates[i].frequency = mergedFreq;
        toDelete.add(candidates[j].id);
        merged++;
      }
    }
  }

  // 2. Promote high-frequency candidates → established
  const refreshed = store.getFacts({ status: "candidate", projectId });
  for (const f of refreshed) {
    if (f.frequency >= PROMOTION_THRESHOLD) {
      store.promoteFact(f.id, "established");
      promoted++;
    }
  }

  // 3. Archive stale candidates (30 days)
  const archived = store.archiveStaleFacts(ARCHIVE_AGE_MS);

  return { merged, promoted, archived, globalPromoted: 0 };
}

/**
 * Promote facts that appear in 2+ projects to global scope.
 * PRD § FR-14.
 *
 * @param {object} store - EventStore instance
 * @returns {number} Number of facts promoted to global
 */
export function promoteToGlobal(store) {
  // Find established facts with same content across different projects
  const established = store.getFacts({ status: "established" });
  const byContent = new Map();

  for (const f of established) {
    if (f.scope === "global") continue;
    const key = f.content.toLowerCase().trim();
    if (!byContent.has(key)) byContent.set(key, new Set());
    if (f.projectId) byContent.get(key).add(f.projectId);
  }

  let count = 0;
  for (const [content, projects] of byContent) {
    if (projects.size >= 2) {
      // Find all matching facts and promote to global
      const matching = established.filter(f =>
        f.content.toLowerCase().trim() === content && f.scope !== "global",
      );
      for (const f of matching) {
        store.db?.prepare?.("UPDATE facts SET scope = 'global', updated_at = ? WHERE id = ?")
          ?.run(Date.now(), f.id);
        count++;
      }
    }
  }

  return count;
}

// Export for testing
export { tokenSimilarity, PROMOTION_THRESHOLD, ARCHIVE_AGE_MS, SIMILARITY_THRESHOLD };
