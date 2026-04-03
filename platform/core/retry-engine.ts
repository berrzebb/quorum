/**
 * Retry Engine — intelligent retry with exponential backoff and jitter.
 *
 * Uses classifyError to determine retry eligibility.
 * validation and auth errors are never retried.
 * retryAfter headers are respected.
 *
 * @module core/retry-engine
 */

import { classifyError, isRetryable } from "./errors.js";
import type { QuorumError, ErrorKind } from "./errors.js";

// ── Types ───────────────────────────────────────────

/** Configuration for retry behavior per error kind. */
export type RetryCategories = Partial<Record<ErrorKind, boolean>>;

/** Retry policy configuration. */
export interface RetryPolicy {
  /** Maximum number of attempts (including the first). Default: 5. */
  maxAttempts: number;
  /** Base delay in milliseconds. Default: 500. */
  baseDelayMs: number;
  /** Maximum delay in milliseconds. Default: 32000. */
  maxDelayMs: number;
  /** Backoff multiplier. Default: 2. */
  backoffMultiplier: number;
  /** Jitter fraction (±X of base delay). Default: 0.25. */
  jitterFraction: number;
  /** Per-kind retry overrides. If not set, uses isRetryable defaults. */
  categories?: RetryCategories;
}

/** Information about a retry attempt. */
export interface RetryAttemptInfo {
  /** Current attempt number (1-based). */
  attempt: number;
  /** Delay before this attempt in ms (0 for first attempt). */
  delay: number;
  /** Error kind that triggered the retry. */
  kind: ErrorKind;
  /** Whether another retry will be attempted. */
  willRetry: boolean;
  /** The classified error. */
  error: QuorumError;
}

/** Callback invoked on each attempt. */
export type OnAttemptCallback = (info: RetryAttemptInfo) => void;

// ── Default Policy ──────────────────────────────────

/** Default retry policy — 5 attempts, 500ms base, 32s cap, ±25% jitter. */
export const DEFAULT_RETRY_POLICY: Readonly<RetryPolicy> = {
  maxAttempts: 5,
  baseDelayMs: 500,
  maxDelayMs: 32_000,
  backoffMultiplier: 2,
  jitterFraction: 0.25,
};

// ── Delay Computation ───────────────────────────────

/**
 * Compute retry delay with exponential backoff and jitter.
 *
 * delay = min(base × multiplier^(attempt-1), cap) ± jitter
 *
 * If retryAfter is provided (from server), it takes precedence.
 */
export function computeDelay(
  attempt: number,
  policy: RetryPolicy,
  retryAfter?: number,
): number {
  // Server-specified delay takes precedence
  if (retryAfter !== undefined && retryAfter > 0) {
    return retryAfter * 1000; // Convert seconds to ms
  }

  const base = Math.min(
    policy.baseDelayMs * Math.pow(policy.backoffMultiplier, attempt - 1),
    policy.maxDelayMs,
  );

  // Jitter: ±jitterFraction of base
  const jitter = base * policy.jitterFraction * (2 * Math.random() - 1);

  return Math.max(0, Math.round(base + jitter));
}

// ── Retry Engine ────────────────────────────────────

/**
 * Retry Engine — executes a function with intelligent retry on failure.
 *
 * Usage:
 * ```ts
 * const engine = new RetryEngine();
 * const result = await engine.execute(() => fetch(url));
 * ```
 */
export class RetryEngine {
  private onAttemptCallbacks: OnAttemptCallback[] = [];

  constructor(private readonly defaultPolicy: RetryPolicy = DEFAULT_RETRY_POLICY) {}

  /** Register a callback for each attempt (for logging/telemetry). */
  onAttempt(cb: OnAttemptCallback): void {
    this.onAttemptCallbacks.push(cb);
  }

  /**
   * Execute a function with retry logic.
   *
   * - Classifies errors via classifyError()
   * - Checks shouldRetry based on kind + policy.categories
   * - Applies exponential backoff + jitter
   * - Respects retryAfter from server
   * - On final failure, throws the original error
   */
  async execute<T>(fn: () => T | Promise<T>, policy?: Partial<RetryPolicy>): Promise<T> {
    const p: RetryPolicy = { ...this.defaultPolicy, ...policy };
    let lastError: unknown;

    for (let attempt = 1; attempt <= p.maxAttempts; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastError = err;
        const classified = classifyError(err);

        // Check if this error kind should be retried
        const shouldRetry = this.shouldRetry(classified, p, attempt);

        if (!shouldRetry) {
          this.emitAttempt({
            attempt,
            delay: 0,
            kind: classified.kind,
            willRetry: false,
            error: classified,
          });
          throw err;
        }

        // Compute delay
        const delay = computeDelay(attempt, p, classified.retryAfter);

        this.emitAttempt({
          attempt,
          delay,
          kind: classified.kind,
          willRetry: attempt < p.maxAttempts,
          error: classified,
        });

        // Wait before next attempt
        if (attempt < p.maxAttempts) {
          await sleep(delay);
        }
      }
    }

    // All attempts exhausted
    throw lastError;
  }

  /** Determine if an error should be retried. */
  private shouldRetry(err: QuorumError, policy: RetryPolicy, attempt: number): boolean {
    if (attempt >= policy.maxAttempts) return false;

    // Per-kind override from policy
    if (policy.categories) {
      const override = policy.categories[err.kind];
      if (override !== undefined) return override;
    }

    // Default behavior from isRetryable
    return isRetryable(err);
  }

  /** Emit attempt info to all registered callbacks. */
  private emitAttempt(info: RetryAttemptInfo): void {
    for (const cb of this.onAttemptCallbacks) {
      try { cb(info); } catch { /* callbacks must not break retry */ }
    }
  }
}

// ── Helpers ─────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
