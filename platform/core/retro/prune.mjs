/**
 * Prune Planner — explicit memory/index prune decisions.
 *
 * Core invariant: every prune action records target + decision + reason.
 * No memory entry is silently deleted — all changes are journaled.
 *
 * @module core/retro/prune
 * @since RDI-4
 */

// ── Types (JSDoc) ────────────────────────────

/**
 * @typedef {"keep"|"merge"|"remove"|"demote"} PruneAction
 */

/**
 * @typedef {Object} PruneDecision
 * @property {string} target - description of the memory/index entry
 * @property {PruneAction} decision - what to do
 * @property {string} reason - why this decision was made
 * @property {string} [replacementTarget] - for merge: what to merge into
 * @property {number} [targetIndex] - index in the original memory array
 */

/**
 * @typedef {Object} PruneJournal
 * @property {PruneDecision[]} decisions
 * @property {number} totalReviewed
 * @property {number} kept
 * @property {number} merged
 * @property {number} removed
 * @property {number} demoted
 */

const DEFAULT_IMPORTANCE = 0.5;

// ── Prune Planning ───────────────────────────

/**
 * Generate prune decisions from gathered signals and existing memory.
 *
 * Rules:
 * - prune_candidate signals → remove or merge
 * - duplicate content → merge into the higher-weight entry
 * - stale entries (old wave) → demote or remove
 * - entries confirmed by decisions → keep
 * - everything else → keep (conservative)
 *
 * @param {import("./signal-gatherer.mjs").RetroSignal[]} signals
 * @param {object[]} memoryEntries - current MemoryEntry/MemoryDigest entries
 * @returns {PruneJournal}
 */
export function planPrune(signals, memoryEntries) {
  /** @type {PruneDecision[]} */
  const decisions = [];

  // Index prune signals by normalized content prefix for O(1) lookup
  const pruneByPrefix = new Map();
  for (const signal of signals) {
    if (signal.kind !== "prune_candidate") continue;
    // Extract the entry content prefix embedded by signal-gatherer
    const match = signal.content.match(/"([^"]{10,30})/);
    if (match) pruneByPrefix.set(normalizeContent(match[1]), signal);
  }

  // Single pass: detect duplicates, match prune signals, default to keep
  const contentMap = new Map();
  const decidedIndices = new Set();

  for (let i = 0; i < memoryEntries.length; i++) {
    const entry = memoryEntries[i];
    const key = normalizeContent(entry.content ?? "");

    // Duplicate detection
    if (contentMap.has(key)) {
      const existingIdx = contentMap.get(key);
      const existing = memoryEntries[existingIdx];
      const keepIdx = (entry.importance ?? DEFAULT_IMPORTANCE) > (existing.importance ?? DEFAULT_IMPORTANCE) ? i : existingIdx;
      const removeIdx = keepIdx === i ? existingIdx : i;
      decisions.push({
        target: memoryEntries[removeIdx].content?.slice(0, 80) ?? `entry[${removeIdx}]`,
        decision: /** @type {PruneAction} */ ("merge"),
        reason: "duplicate content detected",
        replacementTarget: memoryEntries[keepIdx].content?.slice(0, 80) ?? `entry[${keepIdx}]`,
        targetIndex: removeIdx,
      });
      decidedIndices.add(removeIdx);
    } else {
      contentMap.set(key, i);
    }

    // Prune signal matching (stale-memory → demote)
    if (!decidedIndices.has(i)) {
      const prefix = normalizeContent((entry.content ?? "").slice(0, 30));
      const signal = pruneByPrefix.get(prefix);
      if (signal && signal.topic === "stale-memory") {
        decisions.push({
          target: entry.content?.slice(0, 80) ?? `entry[${i}]`,
          decision: /** @type {PruneAction} */ ("demote"),
          reason: signal.content,
          targetIndex: i,
        });
        decidedIndices.add(i);
      }
    }
  }

  // Default: keep everything not already decided
  for (let i = 0; i < memoryEntries.length; i++) {
    if (!decidedIndices.has(i)) {
      decisions.push({
        target: memoryEntries[i].content?.slice(0, 80) ?? `entry[${i}]`,
        decision: /** @type {PruneAction} */ ("keep"),
        reason: "no prune signal",
        targetIndex: i,
      });
    }
  }

  // Compute stats
  const stats = { kept: 0, merged: 0, removed: 0, demoted: 0 };
  for (const d of decisions) {
    stats[d.decision === "keep" ? "kept" : d.decision === "merge" ? "merged" : d.decision === "remove" ? "removed" : "demoted"]++;
  }

  return {
    decisions,
    totalReviewed: memoryEntries.length,
    ...stats,
  };
}

/**
 * Apply prune decisions to memory entries.
 * Returns the surviving entries with updated importance for demoted items.
 *
 * @param {object[]} memoryEntries
 * @param {PruneDecision[]} decisions
 * @returns {object[]}
 */
export function applyPrune(memoryEntries, decisions) {
  const removeIndices = new Set();
  const demoteIndices = new Set();
  const mergeIndices = new Set();

  for (const d of decisions) {
    if (d.targetIndex == null) continue;
    if (d.decision === "remove") removeIndices.add(d.targetIndex);
    if (d.decision === "demote") demoteIndices.add(d.targetIndex);
    if (d.decision === "merge") mergeIndices.add(d.targetIndex);
  }

  const result = [];
  for (let i = 0; i < memoryEntries.length; i++) {
    if (removeIndices.has(i) || mergeIndices.has(i)) continue;

    const entry = { ...memoryEntries[i] };
    if (demoteIndices.has(i)) {
      entry.importance = Math.max(0, (entry.importance ?? DEFAULT_IMPORTANCE) - 0.2);
    }
    result.push(entry);
  }

  return result;
}

// ── Helpers ──────────────────────────────────

function normalizeContent(text) {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}
