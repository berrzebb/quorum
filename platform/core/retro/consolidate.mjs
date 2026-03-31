/**
 * Consolidation Engine — deterministic consolidation of gathered signals.
 *
 * Takes normalized RetroSignals and produces:
 * - Learned constraints (patterns to avoid)
 * - Repeated failures (persistent issues)
 * - Confirmed decisions (settled choices)
 * - Next-wave guidance (actionable hints)
 *
 * This is a DETERMINISTIC engine — same inputs produce same outputs.
 * LLM enrichment is a separate optional layer (RDI-8).
 *
 * @module core/retro/consolidate
 * @since RDI-4
 */

// ── Types (JSDoc) ────────────────────────────

/**
 * @typedef {Object} ConsolidationResult
 * @property {string[]} learnedConstraints
 * @property {string[]} repeatedFailures
 * @property {string[]} confirmedDecisions
 * @property {string[]} nextWaveGuidance
 */

// ── Consolidation ────────────────────────────

/**
 * Run deterministic consolidation on gathered signals.
 *
 * Groups signals by kind and extracts structured output:
 * - finding_repeat → repeatedFailures + guidance
 * - constraint → learnedConstraints
 * - decision → confirmedDecisions
 * - drift/prune_candidate → guidance
 *
 * @param {import("./signal-gatherer.mjs").RetroSignal[]} signals
 * @param {object} [options]
 * @param {number} [options.maxConstraints] - max learned constraints (default 5)
 * @param {number} [options.maxFailures] - max repeated failures (default 5)
 * @param {number} [options.maxDecisions] - max confirmed decisions (default 5)
 * @param {number} [options.maxGuidance] - max guidance items (default 5)
 * @returns {ConsolidationResult}
 */
export function consolidate(signals, options) {
  const maxConstraints = options?.maxConstraints ?? 5;
  const maxFailures = options?.maxFailures ?? 5;
  const maxDecisions = options?.maxDecisions ?? 5;
  const maxGuidance = options?.maxGuidance ?? 5;

  // Sort by weight descending for priority selection
  const sorted = [...signals].sort((a, b) => b.weight - a.weight);

  /** @type {string[]} */
  const learnedConstraints = [];
  /** @type {string[]} */
  const repeatedFailures = [];
  /** @type {string[]} */
  const confirmedDecisions = [];
  /** @type {string[]} */
  const nextWaveGuidance = [];

  for (const signal of sorted) {
    switch (signal.kind) {
      case "finding_repeat":
        if (repeatedFailures.length < maxFailures) {
          repeatedFailures.push(signal.content);
        }
        // Also derive guidance from repeated failures
        if (nextWaveGuidance.length < maxGuidance) {
          nextWaveGuidance.push(`Avoid: ${signal.topic} (repeated ${signal.source} finding)`);
        }
        break;

      case "constraint":
        if (learnedConstraints.length < maxConstraints) {
          learnedConstraints.push(signal.content);
        }
        break;

      case "decision":
        if (confirmedDecisions.length < maxDecisions) {
          confirmedDecisions.push(signal.content);
        }
        break;

      case "drift":
      case "prune_candidate":
        if (nextWaveGuidance.length < maxGuidance) {
          nextWaveGuidance.push(`Review: ${signal.content}`);
        }
        break;
    }
  }

  return {
    learnedConstraints,
    repeatedFailures,
    confirmedDecisions,
    nextWaveGuidance,
  };
}
