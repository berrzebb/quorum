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
