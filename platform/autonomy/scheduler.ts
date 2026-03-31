/**
 * KAIROS Scheduler — idle-only proactive job execution.
 *
 * Runs safe jobs ONLY when ALL conditions are met:
 * 1. Session state is "idle" (no running query or active job)
 * 2. No pending approval (requires_action)
 * 3. Budget available (15s blocking budget per job)
 * 4. Cooldown elapsed since last job
 *
 * Core invariant: requires_action blocks all autonomy.
 * User return or new query kills the current proactive job.
 *
 * @module autonomy/scheduler
 * @since RAI-3
 */

// ── Types ────────────────────────────────────

export type SessionState = "idle" | "running" | "requires_action";

export interface SchedulerInput {
  sessionState: SessionState;
  pendingApprovalCount: number;
  lastJobFinishedAt: number;
  now?: number;
}

export interface SchedulerConfig {
  /** Whether the scheduler is enabled. Default: false. */
  enabled: boolean;
  /** Max blocking time per job in ms. Default: 15000. */
  maxBlockingMs: number;
  /** Cooldown between jobs in ms. Default: 60000. */
  cooldownMs: number;
  /** Minimum idle time before first job in ms. Default: 5000. */
  minIdleMs: number;
}

export interface SchedulerDecision {
  /** Whether a job may start. */
  eligible: boolean;
  /** Reason for the decision. */
  reason: string;
  /** Budget for the job (if eligible). */
  budget?: AutonomyBudget;
}

export interface AutonomyBudget {
  maxBlockingMs: number;
  startedAt: number;
  expiresAt: number;
}

export interface JobResult {
  jobId: string;
  kind: string;
  status: "completed" | "aborted" | "failed";
  summary: string;
  durationMs: number;
  startedAt: number;
  finishedAt: number;
}

// ── Default Config ───────────────────────────

export function defaultSchedulerConfig(): SchedulerConfig {
  return {
    enabled: false,
    maxBlockingMs: 15_000,
    cooldownMs: 60_000,
    minIdleMs: 5_000,
  };
}

// ── Scheduler Evaluation ─────────────────────

/**
 * Evaluate whether a proactive job may start.
 *
 * All 4 gates must pass:
 * 1. Enabled
 * 2. Session idle + no pending approvals
 * 3. Budget available
 * 4. Cooldown elapsed
 */
export function evaluateScheduler(
  input: SchedulerInput,
  config: SchedulerConfig,
): SchedulerDecision {
  const now = input.now ?? Date.now();

  if (!config.enabled) {
    return { eligible: false, reason: "scheduler disabled" };
  }

  // Gate 1: Session must be idle
  if (input.sessionState !== "idle") {
    return { eligible: false, reason: `session is ${input.sessionState}, not idle` };
  }

  // Gate 2: No pending approvals (requires_action)
  if (input.pendingApprovalCount > 0) {
    return { eligible: false, reason: `${input.pendingApprovalCount} pending approval(s)` };
  }

  // Gate 3: Cooldown elapsed
  if (input.lastJobFinishedAt > 0) {
    const elapsed = now - input.lastJobFinishedAt;
    if (elapsed < config.cooldownMs) {
      const remaining = Math.round((config.cooldownMs - elapsed) / 1000);
      return { eligible: false, reason: `cooldown: ${remaining}s remaining` };
    }
  }

  // All gates pass — create budget
  const budget: AutonomyBudget = {
    maxBlockingMs: config.maxBlockingMs,
    startedAt: now,
    expiresAt: now + config.maxBlockingMs,
  };

  return {
    eligible: true,
    reason: "all gates pass",
    budget,
  };
}

/**
 * Check if a running job should be aborted.
 *
 * Abort conditions:
 * 1. Budget expired
 * 2. Session is no longer idle (user returned)
 * 3. New pending approval
 */
export function shouldAbortJob(
  budget: AutonomyBudget,
  currentState: SessionState,
  pendingApprovalCount: number,
  now?: number,
): { abort: boolean; reason: string } {
  const currentTime = now ?? Date.now();

  if (currentTime >= budget.expiresAt) {
    return { abort: true, reason: `budget expired (${budget.maxBlockingMs}ms)` };
  }

  if (currentState !== "idle") {
    return { abort: true, reason: `session changed to ${currentState}` };
  }

  if (pendingApprovalCount > 0) {
    return { abort: true, reason: "new pending approval detected" };
  }

  return { abort: false, reason: "within budget" };
}
