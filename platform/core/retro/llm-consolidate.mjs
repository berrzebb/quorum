/**
 * LLM-Assisted Consolidation Upgrader — optional enrichment over deterministic digest.
 *
 * Core invariant: deterministic digest is the safety floor.
 * LLM failure → return deterministic digest unchanged.
 * LLM success → enhanced wording, better grouping, sharper guidance.
 *
 * This module defines the interface and a default no-op upgrader.
 * Real implementations plug in via the ConsolidationUpgrader interface.
 *
 * @module core/retro/llm-consolidate
 * @since RDI-8
 * @experimental Not part of v0.6.0 simplified flow — retained for future integration.
 */

// ── Types (JSDoc) ────────────────────────────

/**
 * @typedef {Object} UpgradeResult
 * @property {string[]} learnedConstraints - LLM-refined constraints
 * @property {string[]} repeatedFailures - LLM-refined failures
 * @property {string[]} confirmedDecisions - LLM-refined decisions
 * @property {string[]} nextWaveGuidance - LLM-refined guidance
 * @property {number} tokenEstimate - estimated tokens used
 */

/**
 * @typedef {Object} ConsolidationUpgrader
 * @property {string} name - upgrader name (for telemetry)
 * @property {(digest: import("./digest.mjs").RetroDigest) => Promise<UpgradeResult>} upgrade
 */

// ── Default No-Op Upgrader ───────────────────

/**
 * No-op upgrader — passes through deterministic digest unchanged.
 * Used when no LLM is configured or during testing.
 *
 * @type {ConsolidationUpgrader}
 */
export const noopUpgrader = {
  name: "noop",
  upgrade: async (digest) => ({
    learnedConstraints: digest.learnedConstraints,
    repeatedFailures: digest.repeatedFailures,
    confirmedDecisions: digest.confirmedDecisions,
    nextWaveGuidance: digest.nextWaveGuidance,
    tokenEstimate: 0,
  }),
};

// ── Upgrade With Fallback ────────────────────

/**
 * Apply LLM upgrade to a digest, falling back to deterministic on failure.
 *
 * @param {import("./digest.mjs").RetroDigest} digest - deterministic baseline
 * @param {ConsolidationUpgrader} [upgrader] - optional LLM upgrader
 * @returns {Promise<{ digest: import("./digest.mjs").RetroDigest; upgraded: boolean; error?: string }>}
 */
export async function upgradeDigest(digest, upgrader) {
  if (!upgrader || upgrader.name === "noop") {
    return { digest, upgraded: false };
  }

  try {
    const result = await upgrader.upgrade(digest);

    // Merge LLM output into digest (non-destructive: only override non-empty arrays)
    const upgraded = {
      ...digest,
      learnedConstraints: result.learnedConstraints.length > 0
        ? result.learnedConstraints : digest.learnedConstraints,
      repeatedFailures: result.repeatedFailures.length > 0
        ? result.repeatedFailures : digest.repeatedFailures,
      confirmedDecisions: result.confirmedDecisions.length > 0
        ? result.confirmedDecisions : digest.confirmedDecisions,
      nextWaveGuidance: result.nextWaveGuidance.length > 0
        ? result.nextWaveGuidance : digest.nextWaveGuidance,
    };

    return { digest: upgraded, upgraded: true };
  } catch (err) {
    // Invariant: LLM failure → deterministic digest unchanged
    return {
      digest,
      upgraded: false,
      error: `${upgrader.name}: ${err?.message ?? err}`,
    };
  }
}

/**
 * Create a mock upgrader for testing.
 * Appends " (LLM enhanced)" to each constraint.
 *
 * @param {object} [options]
 * @param {boolean} [options.shouldFail] - if true, throws on upgrade
 * @returns {ConsolidationUpgrader}
 */
export function createMockUpgrader(options) {
  return {
    name: "mock-llm",
    upgrade: async (digest) => {
      if (options?.shouldFail) throw new Error("Mock LLM failure");
      return {
        learnedConstraints: digest.learnedConstraints.map(c => `${c} (LLM enhanced)`),
        repeatedFailures: digest.repeatedFailures.map(f => `${f} (LLM enhanced)`),
        confirmedDecisions: digest.confirmedDecisions,
        nextWaveGuidance: digest.nextWaveGuidance.map(g => `${g} (LLM enhanced)`),
        tokenEstimate: 100,
      };
    },
  };
}
