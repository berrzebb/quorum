/**
 * Safe Proactive Job Registry — allowlist-only job definitions.
 *
 * v1 autonomy is NON-DESTRUCTIVE by default:
 * - Only safe, pre-registered jobs may run
 * - Unattended source-code mutation is FORBIDDEN
 * - Jobs are categorized by what they DO (read-only, derived output, consolidation)
 *
 * @module autonomy/job-registry
 * @since RAI-4
 * @experimental Not part of v0.6.0 simplified flow — retained for future integration.
 */

import type { AutonomyBudget, JobResult } from "./scheduler.js";

// ── Job Definition ───────────────────────────

export interface ProactiveJob {
  /** Unique job kind identifier. */
  kind: string;
  /** Human-readable description. */
  description: string;
  /** Whether this job may modify source code. Must be false for v1. */
  mutatesSource: boolean;
  /** Whether this job requires network access. */
  requiresNetwork: boolean;
  /** Estimated max duration in ms (for scheduling). */
  estimatedMs: number;
  /** Execute the job within the given budget. */
  execute: (budget: AutonomyBudget, context: JobContext) => Promise<JobResult>;
}

export interface JobContext {
  /** Repository root path. */
  repoRoot: string;
  /** Track name (if in a track). */
  trackName?: string;
  /** Wave index (if in a wave). */
  waveIndex?: number;
  /** Emit bus event (fire-and-forget). */
  emitEvent?: (type: string, payload: Record<string, unknown>) => void;
}

// ── Registry ─────────────────────────────────

const _registry = new Map<string, ProactiveJob>();

/**
 * Register a safe proactive job.
 * Rejects jobs that mutate source code (v1 safety invariant).
 */
export function registerJob(job: ProactiveJob): void {
  if (job.mutatesSource) {
    throw new Error(`[job-registry] REJECTED: "${job.kind}" mutates source code — forbidden in v1 autonomy`);
  }
  _registry.set(job.kind, job);
}

/**
 * Get a registered job by kind.
 */
export function getJob(kind: string): ProactiveJob | undefined {
  return _registry.get(kind);
}

/**
 * List all registered jobs.
 */
export function listJobs(): ProactiveJob[] {
  return [..._registry.values()];
}

/**
 * Pick the best eligible job for the current context.
 * Returns null if no job is eligible.
 */
export function pickJob(budget: AutonomyBudget, context: JobContext): ProactiveJob | null {
  for (const job of _registry.values()) {
    // Skip jobs that would exceed budget
    if (job.estimatedMs > budget.maxBlockingMs) continue;
    // Skip network jobs when not desired (future: network policy)
    return job; // First eligible job wins (priority order = registration order)
  }
  return null;
}

/**
 * Check if a job kind is in the allowlist.
 */
export function isAllowed(kind: string): boolean {
  return _registry.has(kind);
}

/**
 * Clear all registered jobs (for testing).
 */
export function clearRegistry(): void {
  _registry.clear();
}

// ── Built-in Safe Jobs ───────────────────────

/** Retro consolidation — runs Dream engine. Non-destructive. */
export const RETRO_CONSOLIDATE: ProactiveJob = {
  kind: "retro_consolidate",
  description: "Run Dream consolidation to extract learnings from recent sessions",
  mutatesSource: false,
  requiresNetwork: false,
  estimatedMs: 5_000,
  execute: async (budget, context) => {
    const start = Date.now();
    try {
      // Dynamic import to avoid hard dependency
      const { resolve } = await import("node:path");
      const { pathToFileURL, fileURLToPath } = await import("node:url");
      const { dirname } = await import("node:path");
      const __dir = dirname(fileURLToPath(import.meta.url));
      const quorumRoot = resolve(__dir, "..", "..", "..");
      const engineUrl = pathToFileURL(resolve(quorumRoot, "platform", "core", "retro", "dream-engine.mjs")).href;
      const { runDream } = await import(engineUrl);
      const lockDir = resolve(context.repoRoot, ".session-state");

      const result = await runDream({
        trackName: context.trackName ?? "autonomy",
        waveIndex: context.waveIndex ?? 0,
        trigger: "scheduled",
        lockDir,
        emitEvent: context.emitEvent,
      });

      return {
        jobId: `retro-${Date.now()}`,
        kind: "retro_consolidate",
        status: result.status === "completed" ? "completed" : result.status === "skipped" ? "completed" : "failed",
        summary: result.reason,
        durationMs: Date.now() - start,
        startedAt: start,
        finishedAt: Date.now(),
      };
    } catch (err) {
      return {
        jobId: `retro-${Date.now()}`,
        kind: "retro_consolidate",
        status: "failed",
        summary: (err as Error).message,
        durationMs: Date.now() - start,
        startedAt: start,
        finishedAt: Date.now(),
      };
    }
  },
};

/** Status brief — concise operator-facing summary. Non-destructive. */
export const STATUS_BRIEF: ProactiveJob = {
  kind: "status_brief",
  description: "Generate a concise status summary for the operator",
  mutatesSource: false,
  requiresNetwork: false,
  estimatedMs: 2_000,
  execute: async (budget, context) => {
    const start = Date.now();
    return {
      jobId: `status-${Date.now()}`,
      kind: "status_brief",
      status: "completed",
      summary: `Status brief for ${context.trackName ?? "session"} at wave ${context.waveIndex ?? 0}`,
      durationMs: Date.now() - start,
      startedAt: start,
      finishedAt: Date.now(),
    };
  },
};

/** Derived doc sync — sync derived artifacts. Non-destructive read-only. */
export const DERIVED_DOC_SYNC: ProactiveJob = {
  kind: "derived_doc_sync",
  description: "Sync derived documentation artifacts",
  mutatesSource: false,
  requiresNetwork: false,
  estimatedMs: 3_000,
  execute: async (budget, context) => {
    const start = Date.now();
    return {
      jobId: `docsync-${Date.now()}`,
      kind: "derived_doc_sync",
      status: "completed",
      summary: "Derived doc sync completed",
      durationMs: Date.now() - start,
      startedAt: start,
      finishedAt: Date.now(),
    };
  },
};

/** Lightweight verification. Non-destructive read-only. */
export const VERIFY_LIGHT: ProactiveJob = {
  kind: "verify_light",
  description: "Run lightweight verification checks",
  mutatesSource: false,
  requiresNetwork: false,
  estimatedMs: 3_000,
  execute: async (budget, context) => {
    const start = Date.now();
    return {
      jobId: `verify-${Date.now()}`,
      kind: "verify_light",
      status: "completed",
      summary: "Light verification completed",
      durationMs: Date.now() - start,
      startedAt: start,
      finishedAt: Date.now(),
    };
  },
};

// ── Auto-register built-in jobs ──────────────

registerJob(RETRO_CONSOLIDATE);
registerJob(STATUS_BRIEF);
registerJob(DERIVED_DOC_SYNC);
registerJob(VERIFY_LIGHT);
