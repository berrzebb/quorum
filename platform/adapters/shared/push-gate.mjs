/**
 * Push Gate — pre-commit/push verification.
 *
 * PRD § FR-22: fitness score + HARD rule violations check.
 * strict → block (exit 2), balanced → warn, fast/prototype → skip.
 *
 * @module adapters/shared/push-gate
 */

/** Fitness thresholds per gate profile. */
const FITNESS_THRESHOLDS = {
  strict: 0.7,
  balanced: 0.5,
  fast: 0.3,
  prototype: 0,
};

/**
 * @typedef {Object} PushGateResult
 * @property {boolean} allowed
 * @property {string[]} warnings
 * @property {string} [blockReason]
 */

/**
 * Check if a commit/push should be allowed.
 *
 * @param {object} opts
 * @param {string} opts.gateProfile - Current gate profile
 * @param {number} [opts.fitnessScore] - Current fitness score (0.0-1.0)
 * @param {Array<{id: string, pattern: string}>} [opts.hardViolations] - Active HARD rule violations
 * @returns {PushGateResult}
 */
export function checkPushGate({ gateProfile, fitnessScore, hardViolations }) {
  const warnings = [];

  // Skip for fast/prototype profiles
  if (gateProfile === "fast" || gateProfile === "prototype") {
    return { allowed: true, warnings: [] };
  }

  const threshold = FITNESS_THRESHOLDS[gateProfile] ?? FITNESS_THRESHOLDS.balanced;

  // 1. Fitness check
  if (fitnessScore != null && fitnessScore < threshold) {
    warnings.push(`Fitness score ${fitnessScore.toFixed(2)} below threshold ${threshold} for "${gateProfile}" profile`);
  }

  // 2. HARD rule violations
  if (hardViolations?.length > 0) {
    warnings.push(`${hardViolations.length} HARD rule violation(s): ${hardViolations.map(v => v.pattern).join(", ")}`);
  }

  if (warnings.length === 0) {
    return { allowed: true, warnings: [] };
  }

  // strict → block, balanced → warn only
  if (gateProfile === "strict") {
    return {
      allowed: false,
      warnings,
      blockReason: `[quorum push-gate] BLOCKED: ${warnings.join("; ")}`,
    };
  }

  return { allowed: true, warnings };
}
