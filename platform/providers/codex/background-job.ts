/**
 * Codex Plugin Background Job — wraps codex-plugin-cc's background job system.
 *
 * Enables quorum to submit long-running audits as codex-plugin-cc background jobs.
 * Maps job lifecycle events to quorum bus events for observability.
 *
 * Background jobs are useful for:
 * - Multi-file audits that take > 2 minutes
 * - Adversarial reviews running in parallel with other work
 * - Non-blocking audit submissions during orchestration
 */

import { spawn, spawnSync } from "node:child_process";
import { getCompanionScriptPath, isCodexPluginAvailable } from "./broker-detect.js";

// ── Types ───────────────────────────────────────────────

export interface BackgroundJobRequest {
  /** Task prompt for Codex. */
  prompt: string;
  /** Model to use (optional). */
  model?: string;
  /** Working directory. */
  cwd?: string;
}

export interface BackgroundJobStatus {
  /** Job ID assigned by codex-plugin-cc. */
  jobId: string;
  /** Current status. */
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  /** Human-readable phase description. */
  phase?: string;
  /** ISO timestamp of last update. */
  updatedAt?: string;
}

export interface BackgroundJobResult {
  /** Job ID. */
  jobId: string;
  /** Whether the job completed successfully. */
  success: boolean;
  /** Raw output from the job. */
  output: string;
  /** Error message if failed. */
  error?: string;
}

// ── Job Submission ──────────────────────────────────────

/**
 * Submit a background job to codex-plugin-cc.
 *
 * Returns the job ID for status tracking, or null if submission failed.
 */
export function submitBackgroundJob(request: BackgroundJobRequest): string | null {
  const companionPath = getCompanionScriptPath();
  if (!companionPath) return null;

  const args = [companionPath, "task", "--background", "--json"];
  if (request.model) {
    args.push("--model", request.model);
  }
  args.push(request.prompt);

  try {
    const result = spawnSync(process.execPath, args, {
      cwd: request.cwd ?? process.cwd(),
      encoding: "utf8",
      timeout: 30_000, // 30s for submission only
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });

    const output = (result.stdout ?? "").trim();

    // codex-companion outputs the job ID on submission
    // Try to parse JSON response
    try {
      const parsed = JSON.parse(output);
      return parsed.jobId ?? parsed.job_id ?? parsed.id ?? null;
    } catch {
      // Non-JSON output — try to extract job ID from text
      const match = output.match(/(?:job|task)[-_]?(?:id)?[:\s]+([a-z0-9-]+)/i);
      return match?.[1] ?? null;
    }
  } catch {
    return null;
  }
}

// ── Job Status ──────────────────────────────────────────

/**
 * Query the status of a codex-plugin-cc background job.
 */
export function queryJobStatus(jobId: string, cwd?: string): BackgroundJobStatus | null {
  const companionPath = getCompanionScriptPath();
  if (!companionPath) return null;

  const args = [companionPath, "status", "--json", jobId];

  try {
    const result = spawnSync(process.execPath, args, {
      cwd: cwd ?? process.cwd(),
      encoding: "utf8",
      timeout: 10_000,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });

    const output = (result.stdout ?? "").trim();
    if (!output) return null;

    const parsed = JSON.parse(output);

    // Handle both single job and job list formats
    const job = parsed.job ?? parsed.jobs?.[0] ?? parsed;
    return {
      jobId: job.jobId ?? job.job_id ?? job.id ?? jobId ?? "unknown",
      status: normalizeStatus(job.status ?? job.phase),
      phase: job.phase,
      updatedAt: job.updatedAt ?? job.updated_at,
    };
  } catch {
    return null;
  }
}

// ── Job Result ──────────────────────────────────────────

/**
 * Retrieve the result of a completed codex-plugin-cc background job.
 */
export function getJobResult(jobId: string, cwd?: string): BackgroundJobResult | null {
  const companionPath = getCompanionScriptPath();
  if (!companionPath) return null;

  const args = [companionPath, "result", "--json", jobId];

  try {
    const result = spawnSync(process.execPath, args, {
      cwd: cwd ?? process.cwd(),
      encoding: "utf8",
      timeout: 10_000,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });

    const output = (result.stdout ?? "").trim();
    if (!output) return null;

    try {
      const parsed = JSON.parse(output);
      const job = parsed.job ?? parsed;
      return {
        jobId: job.jobId ?? job.job_id ?? job.id ?? jobId ?? "unknown",
        success: job.status === "completed",
        output: job.output ?? job.result ?? output,
        error: job.errorMessage ?? job.error,
      };
    } catch {
      // Non-JSON result
      return {
        jobId: jobId ?? "unknown",
        success: result.status === 0,
        output,
      };
    }
  } catch {
    return null;
  }
}

// ── Job Cancellation ────────────────────────────────────

/**
 * Cancel a running codex-plugin-cc background job.
 */
export function cancelJob(jobId: string, cwd?: string): boolean {
  const companionPath = getCompanionScriptPath();
  if (!companionPath) return false;

  const args = [companionPath, "cancel", "--json", jobId];

  try {
    const result = spawnSync(process.execPath, args, {
      cwd: cwd ?? process.cwd(),
      encoding: "utf8",
      timeout: 10_000,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    return result.status === 0;
  } catch {
    return false;
  }
}

// ── Helpers ─────────────────────────────────────────────

function normalizeStatus(raw: string | undefined): BackgroundJobStatus["status"] {
  if (!raw) return "queued";
  const lower = raw.toLowerCase();
  if (lower.includes("complete") || lower === "done") return "completed";
  if (lower.includes("fail") || lower === "error") return "failed";
  if (lower.includes("cancel")) return "cancelled";
  if (lower.includes("run") || lower === "starting" || lower === "in_progress") return "running";
  return "queued";
}
