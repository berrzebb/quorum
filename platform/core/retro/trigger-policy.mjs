/**
 * Retro Intelligence — Trigger Policy (Dream-style 3-gate evaluation).
 *
 * Separates two independent state dimensions:
 * - `retroPending`: human retro gate (blocks session until human completes retro)
 * - `consolidationStatus`: Dream intelligence state (idle/pending/running/ready/failed)
 *
 * Consolidation is eligible when ALL 3 gates pass:
 * 1. Time gate: enough hours since last consolidation
 * 2. Sessions gate: enough sessions accumulated since last consolidation
 * 3. Lock gate: consolidation lock is available (no other writer)
 *
 * Core invariant: Dream success NEVER clears `retroPending`.
 * Consolidation and human retro gate are independent lifecycles.
 *
 * @module core/retro/trigger-policy
 * @since RDI-1
 */

// ── State Model ──────────────────────────────

/**
 * @typedef {"idle"|"pending"|"running"|"ready"|"failed"} ConsolidationStatus
 */

/**
 * Combined retro + consolidation state.
 *
 * @typedef {Object} RetroState
 * @property {boolean} retroPending - human retro gate is blocking
 * @property {ConsolidationStatus} consolidationStatus - Dream intelligence state
 * @property {number|null} lastConsolidatedAt - epoch ms of last successful consolidation
 * @property {string|null} lastDigestId - reference to the latest digest
 * @property {number} sessionsSinceLastConsolidation - session count since last consolidation
 */

/**
 * @returns {RetroState}
 */
export function createRetroState() {
  return {
    retroPending: false,
    consolidationStatus: /** @type {ConsolidationStatus} */ ("idle"),
    lastConsolidatedAt: null,
    lastDigestId: null,
    sessionsSinceLastConsolidation: 0,
  };
}

// ── Trigger Snapshot ─────────────────────────

/**
 * 3-gate trigger evaluation result.
 *
 * @typedef {Object} TriggerSnapshot
 * @property {number} hoursSince - hours since last consolidation
 * @property {number} sessionsSince - sessions since last consolidation
 * @property {boolean} lockAvailable - whether consolidation lock can be acquired
 * @property {boolean} eligible - whether all 3 gates pass
 * @property {string} reason - human-readable evaluation reason
 * @property {boolean[]} gates - [time, sessions, lock] individual gate results
 */

/** Default trigger thresholds. */
export const DEFAULT_TRIGGER_THRESHOLDS = {
  /** Minimum hours since last consolidation. */
  minHours: 24,
  /** Minimum sessions accumulated. */
  minSessions: 5,
};

/**
 * Evaluate whether consolidation should trigger.
 *
 * All 3 gates must pass for eligibility:
 * 1. Time: hours since last consolidation >= threshold
 * 2. Sessions: accumulated sessions >= threshold
 * 3. Lock: consolidation lock is available
 *
 * @param {RetroState} state - current retro state
 * @param {boolean} lockAvailable - whether lock can be acquired
 * @param {object} [thresholds] - override default thresholds
 * @param {number} [thresholds.minHours]
 * @param {number} [thresholds.minSessions]
 * @param {number} [now] - override current time for testing
 * @returns {TriggerSnapshot}
 */
export function evaluateTrigger(state, lockAvailable, thresholds, now) {
  const t = { ...DEFAULT_TRIGGER_THRESHOLDS, ...thresholds };
  const currentTime = now ?? Date.now();

  // Gate 1: Time since last consolidation
  const hoursSince = state.lastConsolidatedAt != null
    ? (currentTime - state.lastConsolidatedAt) / (1000 * 60 * 60)
    : Infinity;
  const timeGate = hoursSince >= t.minHours;

  // Gate 2: Sessions accumulated
  const sessionsSince = state.sessionsSinceLastConsolidation;
  const sessionsGate = sessionsSince >= t.minSessions;

  // Gate 3: Lock availability
  const lockGate = lockAvailable;

  const eligible = timeGate && sessionsGate && lockGate;

  // Build reason
  const reasons = [];
  if (!timeGate) reasons.push(`time: ${hoursSince.toFixed(1)}h < ${t.minHours}h`);
  if (!sessionsGate) reasons.push(`sessions: ${sessionsSince} < ${t.minSessions}`);
  if (!lockGate) reasons.push("lock: unavailable");

  const reason = eligible
    ? `all gates pass (${hoursSince.toFixed(1)}h, ${sessionsSince} sessions, lock available)`
    : `blocked: ${reasons.join(", ")}`;

  return {
    hoursSince,
    sessionsSince,
    lockAvailable,
    eligible,
    reason,
    gates: [timeGate, sessionsGate, lockGate],
  };
}

/**
 * Evaluate a micro-trigger for wave-end consolidation.
 *
 * Wave-end is a lighter trigger — only requires lock availability.
 * Time and session gates are relaxed because the wave boundary itself
 * is the signal that consolidation is meaningful.
 *
 * @param {boolean} lockAvailable
 * @param {boolean} waveHadFailures - whether the wave had audit failures
 * @returns {TriggerSnapshot}
 */
export function evaluateWaveEndTrigger(lockAvailable, waveHadFailures) {
  // Wave-end always has enough "time" and "sessions" by definition
  const eligible = lockAvailable;
  const reason = eligible
    ? `wave-end trigger (failures=${waveHadFailures}, lock available)`
    : "wave-end blocked: lock unavailable";

  return {
    hoursSince: 0,
    sessionsSince: 0,
    lockAvailable,
    eligible,
    reason,
    gates: [true, true, lockAvailable],
  };
}

// ── State Transitions ────────────────────────

/**
 * Transition consolidation status.
 *
 * Valid transitions:
 * - idle → pending (trigger eligible)
 * - pending → running (lock acquired)
 * - running → ready (consolidation succeeded)
 * - running → failed (consolidation errored)
 * - failed → idle (reset after delay)
 * - ready → idle (digest consumed or aged out)
 *
 * @param {RetroState} state
 * @param {ConsolidationStatus} newStatus
 * @param {object} [extra] - additional fields to update
 * @param {number} [extra.lastConsolidatedAt]
 * @param {string} [extra.lastDigestId]
 * @returns {RetroState}
 */
export function transitionConsolidation(state, newStatus, extra) {
  return {
    ...state,
    consolidationStatus: newStatus,
    ...(extra?.lastConsolidatedAt != null ? { lastConsolidatedAt: extra.lastConsolidatedAt } : {}),
    ...(extra?.lastDigestId != null ? { lastDigestId: extra.lastDigestId } : {}),
    // Reset session counter on successful consolidation
    ...(newStatus === "ready" ? { sessionsSinceLastConsolidation: 0 } : {}),
  };
}

/**
 * Increment session counter.
 * Called when a new session/wave completes.
 *
 * @param {RetroState} state
 * @returns {RetroState}
 */
export function incrementSessions(state) {
  return {
    ...state,
    sessionsSinceLastConsolidation: state.sessionsSinceLastConsolidation + 1,
  };
}

/**
 * Build RetroState from marker file content and KV store data.
 *
 * @param {object|null} marker - retro-marker.json content
 * @param {object|null} kvData - kv_state dream:state content
 * @returns {RetroState}
 */
export function buildRetroState(marker, kvData) {
  const state = createRetroState();

  // Human retro gate from marker
  if (marker?.retro_pending) {
    state.retroPending = true;
  }

  // Consolidation state from KV
  if (kvData) {
    state.consolidationStatus = kvData.consolidationStatus ?? "idle";
    state.lastConsolidatedAt = kvData.lastConsolidatedAt ?? null;
    state.lastDigestId = kvData.lastDigestId ?? null;
    state.sessionsSinceLastConsolidation = kvData.sessionsSinceLastConsolidation ?? 0;
  }

  return state;
}
