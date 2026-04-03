/**
 * Decision Reason Tracking — structured audit trail for all error/permission decisions.
 *
 * Wraps operations to collect decision reasons and optionally
 * persist them to the EventStore for retrospective analysis.
 *
 * @module core/decision-reason
 */

// ── Types ───────────────────────────────────────────

/** Types of decisions that can be tracked. */
export type DecisionType = "error" | "retry" | "skip" | "fallback" | "timeout" | "permission" | "recovery";

/** A single decision reason record. */
export interface DecisionReason {
  /** Decision type. */
  type: DecisionType;
  /** Human-readable reason. */
  reason: string;
  /** Additional context (structured data). */
  context?: Record<string, unknown>;
  /** When the decision was made. */
  timestamp: number;
}

/** Result of a withReason-wrapped operation. */
export interface ReasonedResult<T> {
  /** The operation result. */
  result: T;
  /** All decisions made during the operation. */
  reasons: DecisionReason[];
}

/** Store interface for persisting decisions (subset of EventStore). */
export interface DecisionStore {
  emit(type: string, payload: Record<string, unknown>): void;
}

// ── Reason Collection ───────────────────────────────

/**
 * Create a decision reason record.
 */
export function createReason(
  type: DecisionType,
  reason: string,
  context?: Record<string, unknown>,
): DecisionReason {
  return { type, reason, context, timestamp: Date.now() };
}

/**
 * Wrap an operation to collect all decision reasons.
 *
 * The operation receives a `record` function to log decisions.
 * All logged decisions are returned alongside the result.
 */
export async function withReason<T>(
  fn: (record: (reason: DecisionReason) => void) => T | Promise<T>,
): Promise<ReasonedResult<T>> {
  const reasons: DecisionReason[] = [];
  const record = (reason: DecisionReason) => { reasons.push(reason); };

  const result = await fn(record);
  return { result, reasons };
}

/**
 * Synchronous version of withReason.
 */
export function withReasonSync<T>(
  fn: (record: (reason: DecisionReason) => void) => T,
): ReasonedResult<T> {
  const reasons: DecisionReason[] = [];
  const record = (reason: DecisionReason) => { reasons.push(reason); };

  const result = fn(record);
  return { result, reasons };
}

// ── Persistence ─────────────────────────────────────

/**
 * Log a decision reason to the store.
 *
 * Emits a `decision.reason` event for audit trail.
 * Fail-open: store errors are silently ignored.
 */
export function logDecision(store: DecisionStore, reason: DecisionReason): void {
  try {
    store.emit("decision.reason", {
      type: reason.type,
      reason: reason.reason,
      context: reason.context,
      timestamp: reason.timestamp,
    });
  } catch { /* fail-open */ }
}

/**
 * Log multiple decision reasons at once.
 */
export function logDecisions(store: DecisionStore, reasons: DecisionReason[]): void {
  for (const reason of reasons) {
    logDecision(store, reason);
  }
}
