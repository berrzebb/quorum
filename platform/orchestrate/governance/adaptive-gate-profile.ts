/**
 * Adaptive gate profiles — risk-based gate subset selection.
 *
 * Instead of running all 21 gates for every task, selects a minimum
 * sufficient subset based on detected triggers (security, cross-layer, etc.).
 * Higher-risk changes activate more gates; low-risk changes skip optional ones.
 */

export interface AdaptiveGateProfile {
  profileId: string;
  triggers: string[];        // what activates this profile (e.g., 'security', 'cross-layer', 'api')
  requiredGates: string[];   // gates that MUST run
  optionalGates: string[];   // gates that CAN run if resources allow
}

// ── Predefined Profiles ─────────────────────────────────────────────────────

export const MINIMAL_PROFILE: AdaptiveGateProfile = {
  profileId: 'minimal',
  triggers: [],
  requiredGates: ['scope', 'build', 'test'],
  optionalGates: [],
};

export const STANDARD_PROFILE: AdaptiveGateProfile = {
  profileId: 'standard',
  triggers: ['default'],
  requiredGates: ['scope', 'build', 'test', 'lint', 'blueprint', 'fitness'],
  optionalGates: ['perf', 'a11y'],
};

export const FULL_PROFILE: AdaptiveGateProfile = {
  profileId: 'full',
  triggers: ['security', 'cross-layer', 'api', 'data-migration'],
  requiredGates: [
    'scope', 'build', 'test', 'lint', 'blueprint', 'fitness',
    'perf', 'a11y', 'security', 'compat', 'license', 'dependency',
    'orphan', 'test-file', 'stub', 'size',
  ],
  optionalGates: ['e2e', 'runtime-evaluation'],
};

// ── Profile Selection ───────────────────────────────────────────────────────

/**
 * Select the appropriate gate profile based on detected triggers.
 * Returns the highest-priority matching profile (most gates first).
 * Falls back to STANDARD_PROFILE when no trigger matches.
 */
export function selectGateProfile(
  detectedTriggers: string[],
  profiles?: AdaptiveGateProfile[],
): AdaptiveGateProfile {
  const allProfiles = profiles ?? [FULL_PROFILE, STANDARD_PROFILE, MINIMAL_PROFILE];
  // Sort by required gates count descending (more gates = higher priority)
  const sorted = [...allProfiles].sort(
    (a, b) => b.requiredGates.length - a.requiredGates.length,
  );

  for (const profile of sorted) {
    if (profile.triggers.some((t) => detectedTriggers.includes(t))) {
      return profile;
    }
  }
  return STANDARD_PROFILE; // default
}

// ── Gate Queries ─────────────────────────────────────────────────────────────

/**
 * Get the effective gate list for a profile.
 * When includeOptional is true, optional gates are appended.
 */
export function getEffectiveGates(
  profile: AdaptiveGateProfile,
  includeOptional: boolean = false,
): string[] {
  return includeOptional
    ? [...profile.requiredGates, ...profile.optionalGates]
    : [...profile.requiredGates];
}

/**
 * Check if a specific gate should run for this profile.
 * Returns true if the gate is in either the required or optional list.
 */
export function shouldRunGate(
  profile: AdaptiveGateProfile,
  gateName: string,
): boolean {
  return (
    profile.requiredGates.includes(gateName) ||
    profile.optionalGates.includes(gateName)
  );
}

// ── RTI-1B: Gate Profile Telemetry ──────────────────────────────────────────

/**
 * Telemetry record for gate profile selection outcomes.
 * @since RTI-1B
 */
export interface GateProfileTelemetryRecord {
  /** Timestamp. */
  ts: number;
  /** Selected profile ID. */
  profileId: string;
  /** Input triggers that drove the selection. */
  inputTriggers: string[];
  /** Number of required gates in selected profile. */
  requiredGateCount: number;
  /** Number of optional gates in selected profile. */
  optionalGateCount: number;
  /** Whether the selection fell back to the standard profile. */
  usedDefault: boolean;
}

/** Callback for gate profile telemetry consumers. */
export type GateProfileTelemetryCallback = (record: GateProfileTelemetryRecord) => void;

const _gateProfileTelemetryCallbacks: GateProfileTelemetryCallback[] = [];

/** Register a gate profile telemetry callback. @since RTI-1B */
export function onGateProfileTelemetry(cb: GateProfileTelemetryCallback): void {
  _gateProfileTelemetryCallbacks.push(cb);
}

/**
 * Select profile and emit telemetry (convenience wrapper).
 * @since RTI-1B
 */
export function selectGateProfileWithTelemetry(
  detectedTriggers: string[],
  profiles?: AdaptiveGateProfile[],
): AdaptiveGateProfile {
  const selected = selectGateProfile(detectedTriggers, profiles);
  const usedDefault = selected.profileId === STANDARD_PROFILE.profileId
    && !detectedTriggers.some(t => STANDARD_PROFILE.triggers.includes(t));

  if (_gateProfileTelemetryCallbacks.length > 0) {
    const record: GateProfileTelemetryRecord = {
      ts: Date.now(),
      profileId: selected.profileId,
      inputTriggers: detectedTriggers,
      requiredGateCount: selected.requiredGates.length,
      optionalGateCount: selected.optionalGates.length,
      usedDefault,
    };
    for (const cb of _gateProfileTelemetryCallbacks) {
      try { cb(record); } catch { /* telemetry must not break gate selection */ }
    }
  }

  return selected;
}

// ═══ RTI-7: Speculation Predictor (Shadow Mode) ═════════════════════════

/**
 * Input features for the speculation predictor.
 * Drawn from telemetry: fitness trend, correction rounds, approval density, etc.
 * @since RTI-7
 */
export interface SpeculationInput {
  /** Recent fitness scores (most recent last). */
  fitnessTrend: number[];
  /** Number of correction rounds in recent waves. */
  correctionRounds: number;
  /** Approval request density (approvals per wave). */
  approvalDensity: number;
  /** Transcript churn (lines per wave). */
  transcriptChurn: number;
  /** Number of changed files. */
  changedFileCount: number;
  /** Detected domains (e.g., "security", "perf"). */
  domains: string[];
  /** Current gate profile ID. */
  currentProfile: string;
}

/**
 * Speculation predictor output.
 * @since RTI-7
 */
export interface SpeculationResult {
  /** Predicted likelihood this WB passes all gates on first try (0.0 - 1.0). */
  passLikelihood: number;
  /** Recommended gate profile (may be lighter than current). */
  recommendedProfile: string;
  /** Confidence in the prediction (0.0 - 1.0). */
  confidence: number;
  /** Reasoning for the prediction. */
  reason: string;
  /** Whether this prediction should affect gate behavior (always false in shadow). */
  enforce: false;
}

/**
 * Shadow speculation predictor.
 *
 * Uses simple heuristics to predict pass-likelihood.
 * ALWAYS returns enforce: false — this is shadow mode only.
 * The prediction is recorded for calibration but NEVER changes gate behavior.
 *
 * Core invariant: speculation starts in shadow mode.
 * RTI-9 will add the enforcement path after calibration.
 *
 * @since RTI-7
 */
export function speculatePassLikelihood(input: SpeculationInput): SpeculationResult {
  // Feature weights (empirically tuned later via calibration)
  let score = 0.5; // baseline: coin flip

  // Fitness trend: improving → higher likelihood
  if (input.fitnessTrend.length >= 2) {
    const recent = input.fitnessTrend.slice(-3);
    const trend = recent[recent.length - 1] - recent[0];
    score += trend * 0.3; // +0.3 per 1.0 fitness improvement
  }

  // High fitness → higher likelihood
  if (input.fitnessTrend.length > 0) {
    const latest = input.fitnessTrend[input.fitnessTrend.length - 1];
    if (latest >= 0.9) score += 0.15;
    else if (latest >= 0.8) score += 0.05;
    else if (latest < 0.6) score -= 0.15;
  }

  // Few correction rounds → higher likelihood
  if (input.correctionRounds === 0) score += 0.1;
  else if (input.correctionRounds >= 3) score -= 0.2;

  // Low approval density → simpler task
  if (input.approvalDensity <= 2) score += 0.05;
  else if (input.approvalDensity >= 10) score -= 0.1;

  // Few changed files → smaller scope
  if (input.changedFileCount <= 3) score += 0.05;
  else if (input.changedFileCount >= 15) score -= 0.1;

  // High-risk domains reduce likelihood
  const riskDomains = ["security", "data-migration", "cross-layer"];
  if (input.domains.some(d => riskDomains.includes(d))) score -= 0.15;

  // Clamp to [0, 1]
  const passLikelihood = Math.max(0, Math.min(1, score));

  // Recommend lighter profile for high-likelihood tasks
  let recommendedProfile = input.currentProfile;
  if (passLikelihood >= 0.85) {
    recommendedProfile = "minimal";
  } else if (passLikelihood >= 0.7) {
    recommendedProfile = "standard";
  }

  // Confidence based on data availability
  const dataPoints = input.fitnessTrend.length + (input.correctionRounds > 0 ? 1 : 0);
  const confidence = Math.min(0.9, 0.3 + dataPoints * 0.1);

  return {
    passLikelihood,
    recommendedProfile,
    confidence,
    reason: `score=${passLikelihood.toFixed(2)}, fitness_trend=${input.fitnessTrend.length}pts, corrections=${input.correctionRounds}, files=${input.changedFileCount}`,
    enforce: false, // SHADOW MODE — NEVER changes gate behavior
  };
}

/** Callback for speculation telemetry. */
export type SpeculationTelemetryCallback = (
  input: SpeculationInput,
  result: SpeculationResult,
  actualOutcome?: "pass" | "fail",
) => void;

const _speculationCallbacks: SpeculationTelemetryCallback[] = [];

/** Register a speculation telemetry callback. @since RTI-7 */
export function onSpeculationTelemetry(cb: SpeculationTelemetryCallback): void {
  _speculationCallbacks.push(cb);
}

/** Emit speculation telemetry for calibration. @since RTI-7 */
export function emitSpeculation(
  input: SpeculationInput,
  result: SpeculationResult,
  actualOutcome?: "pass" | "fail",
): void {
  for (const cb of _speculationCallbacks) {
    try { cb(input, result, actualOutcome); } catch { /* telemetry must not break */ }
  }
}
