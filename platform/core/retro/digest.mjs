/**
 * RetroDigest — consolidated learning artifact.
 *
 * RetroDigest is a DERIVED artifact — never the source of truth.
 * It's produced by the Dream consolidation engine and consumed by:
 * - wave-compact (bounded carryover)
 * - dependency-context (next-wave guidance)
 * - daemon (operator visibility)
 *
 * Core invariant: digest is deterministic given the same inputs.
 *
 * @module core/retro/digest
 * @since RDI-4
 */

// ── Types (JSDoc) ────────────────────────────

/**
 * @typedef {Object} RetroDigest
 * @property {string} id - unique digest identifier
 * @property {string} trackName - track that produced this digest
 * @property {number} [waveIndex] - wave index (if wave-end trigger)
 * @property {string[]} learnedConstraints - patterns to avoid
 * @property {string[]} repeatedFailures - persistent issues
 * @property {string[]} confirmedDecisions - settled choices
 * @property {string[]} nextWaveGuidance - actionable hints
 * @property {import("./prune.mjs").PruneDecision[]} pruneDecisions - memory changes
 * @property {number} generatedAt - epoch ms
 * @property {"wave-end"|"scheduled"|"manual"} source - trigger type
 * @property {object} stats - gathering/consolidation stats
 */

// ── Constants ────────────────────────────────

/** Max items per category in carryover selection. */
export const MAX_CARRYOVER_PER_CATEGORY = 3;

/** Max total items in bounded carryover. */
export const MAX_CARRYOVER_TOTAL = 5;

// ── Digest Generation ────────────────────────

/**
 * Generate a RetroDigest from consolidation + prune results.
 *
 * @param {object} input
 * @param {string} input.trackName
 * @param {number} [input.waveIndex]
 * @param {import("./consolidate.mjs").ConsolidationResult} input.consolidation
 * @param {import("./prune.mjs").PruneJournal} input.pruneJournal
 * @param {"wave-end"|"scheduled"|"manual"} input.source
 * @param {object} [input.stats] - gather stats
 * @returns {RetroDigest}
 */
export function generateDigest(input) {
  const id = `digest-${input.trackName}-${input.waveIndex ?? "all"}-${Date.now()}`;

  return {
    id,
    trackName: input.trackName,
    waveIndex: input.waveIndex,
    learnedConstraints: input.consolidation.learnedConstraints,
    repeatedFailures: input.consolidation.repeatedFailures,
    confirmedDecisions: input.consolidation.confirmedDecisions,
    nextWaveGuidance: input.consolidation.nextWaveGuidance,
    pruneDecisions: input.pruneJournal.decisions,
    generatedAt: Date.now(),
    source: input.source,
    stats: {
      ...(input.stats ?? {}),
      pruneReviewed: input.pruneJournal.totalReviewed,
      pruneKept: input.pruneJournal.kept,
      pruneMerged: input.pruneJournal.merged,
      pruneRemoved: input.pruneJournal.removed,
      pruneDemoted: input.pruneJournal.demoted,
    },
  };
}

// ── Bounded Carryover Selection ──────────────

/**
 * Select bounded carryover items from a digest.
 *
 * Priority order:
 * 1. Learned constraints (most actionable)
 * 2. Repeated failures (most urgent)
 * 3. Next-wave guidance (helpful context)
 *
 * Total bounded by MAX_CARRYOVER_TOTAL.
 *
 * @param {RetroDigest} digest
 * @returns {string[]}
 */
export function selectCarryover(digest) {
  const items = [];

  // Priority 1: learned constraints
  for (const c of digest.learnedConstraints.slice(0, MAX_CARRYOVER_PER_CATEGORY)) {
    items.push(`[constraint] ${c}`);
    if (items.length >= MAX_CARRYOVER_TOTAL) return items;
  }

  // Priority 2: repeated failures
  for (const f of digest.repeatedFailures.slice(0, MAX_CARRYOVER_PER_CATEGORY)) {
    items.push(`[failure] ${f}`);
    if (items.length >= MAX_CARRYOVER_TOTAL) return items;
  }

  // Priority 3: guidance
  for (const g of digest.nextWaveGuidance.slice(0, MAX_CARRYOVER_PER_CATEGORY)) {
    items.push(`[guidance] ${g}`);
    if (items.length >= MAX_CARRYOVER_TOTAL) return items;
  }

  return items;
}

/**
 * Format digest carryover as prompt context.
 *
 * @param {RetroDigest} digest
 * @returns {string}
 */
export function formatDigestContext(digest) {
  const items = selectCarryover(digest);
  if (items.length === 0) return "";

  const sections = [
    `## Retro Intelligence (${digest.source}, ${digest.trackName}${digest.waveIndex != null ? ` wave ${digest.waveIndex}` : ""})`,
    "",
    ...items.map(item => `- ${item}`),
  ];

  return sections.join("\n");
}

/**
 * Serialize digest for storage (SQLite event payload or JSON file).
 *
 * @param {RetroDigest} digest
 * @returns {string}
 */
export function serializeDigest(digest) {
  return JSON.stringify(digest, null, 2);
}

/**
 * Deserialize digest from storage.
 *
 * @param {string} json
 * @returns {RetroDigest|null}
 */
export function deserializeDigest(json) {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/**
 * Summarize a digest for event stream / daemon display.
 *
 * @param {RetroDigest} digest
 * @returns {string}
 */
export function summarizeDigest(digest) {
  const parts = [];
  if (digest.learnedConstraints.length > 0) parts.push(`${digest.learnedConstraints.length} constraints`);
  if (digest.repeatedFailures.length > 0) parts.push(`${digest.repeatedFailures.length} repeated failures`);
  if (digest.confirmedDecisions.length > 0) parts.push(`${digest.confirmedDecisions.length} decisions`);
  if (digest.nextWaveGuidance.length > 0) parts.push(`${digest.nextWaveGuidance.length} guidance`);

  const pruneActions = digest.pruneDecisions.filter(d => d.decision !== "keep").length;
  if (pruneActions > 0) parts.push(`${pruneActions} prune actions`);

  return `Dream digest (${digest.source}): ${parts.join(", ") || "empty"}`;
}
