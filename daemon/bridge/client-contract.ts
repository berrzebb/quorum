/**
 * Client Contract — remote operator UI surface contract.
 *
 * Defines the shape of data remote clients (browser/mobile) consume.
 * This is NOT a UI framework — it's the data contract that any
 * remote client implementation (React, SwiftUI, etc.) builds on.
 *
 * @module daemon/bridge/client-contract
 * @since RAI-8
 * @experimental Not part of v0.6.0 simplified flow — retained for future integration.
 */

import type { RemoteSessionState, PendingAction, RemoteTrackInfo, RemoteEvent, DreamStatus } from "./server.js";

// ── Operator Console Views ───────────────────

/**
 * Status panel — top-level overview for the operator.
 */
export interface StatusView {
  /** Session tri-state. */
  state: RemoteSessionState["state"];
  /** Short summary of current activity. */
  summary: string;
  /** Active track count and progress. */
  tracks: RemoteTrackInfo[];
  /** Dream consolidation status. */
  dream: DreamStatus | null;
  /** Timestamp of last update. */
  updatedAt: number;
}

/**
 * Approval panel — pending human decisions.
 */
export interface ApprovalView {
  /** Pending actions requiring human judgment. */
  pending: PendingAction[];
  /** Number of recently resolved approvals. */
  recentResolved: number;
}

/**
 * Jobs panel — autonomy job status.
 */
export interface JobsView {
  /** Currently running job (if any). */
  activeJob: ActiveJobInfo | null;
  /** Recent completed jobs. */
  recentJobs: CompletedJobInfo[];
  /** Scheduler status. */
  schedulerEnabled: boolean;
  /** Next eligible time (if in cooldown). */
  nextEligibleAt: number | null;
}

export interface ActiveJobInfo {
  jobId: string;
  kind: string;
  startedAt: number;
  budgetRemainingMs: number;
}

export interface CompletedJobInfo {
  jobId: string;
  kind: string;
  status: "completed" | "aborted" | "failed";
  summary: string;
  durationMs: number;
  finishedAt: number;
}

/**
 * Event feed — live event stream for the operator.
 */
export interface EventFeedView {
  events: RemoteEvent[];
}

// ── Notification Contract ────────────────────

/**
 * Key transitions that should produce notifications.
 */
export type NotificationType =
  | "approval_required"    // New pending approval
  | "approval_resolved"    // Approval was allowed/denied
  | "session_idle"         // Session went idle (autonomy may start)
  | "session_active"       // Session became active (user returned)
  | "job_started"          // Proactive job started
  | "job_completed"        // Proactive job finished
  | "dream_completed"      // Dream consolidation finished
  | "track_completed";     // Track milestone reached

export interface Notification {
  type: NotificationType;
  title: string;
  body: string;
  ts: number;
  actionRequired: boolean;
}

// ── View Projection ──────────────────────────

/**
 * Project a RemoteSessionState into operator console views.
 */
export function projectStatusView(state: RemoteSessionState): StatusView {
  return {
    state: state.state,
    summary: state.latestTaskSummary,
    tracks: state.activeTracks,
    dream: state.dreamStatus,
    updatedAt: state.updatedAt,
  };
}

/**
 * Project approval view from state.
 */
export function projectApprovalView(state: RemoteSessionState): ApprovalView {
  return {
    pending: state.pendingAction ? [state.pendingAction] : [],
    recentResolved: 0, // TODO: track from events when needed
  };
}

/**
 * Generate notifications from state transitions.
 */
export function detectNotifications(
  previous: RemoteSessionState | null,
  current: RemoteSessionState,
): Notification[] {
  const notifications: Notification[] = [];
  const now = current.updatedAt;

  // New pending approval
  if (current.pendingAction && (!previous || !previous.pendingAction)) {
    notifications.push({
      type: "approval_required",
      title: "Approval Required",
      body: `${current.pendingAction.kind}: ${current.pendingAction.reason}`,
      ts: now,
      actionRequired: true,
    });
  }

  // Approval resolved
  if (previous?.pendingAction && !current.pendingAction) {
    notifications.push({
      type: "approval_resolved",
      title: "Approval Resolved",
      body: `${previous.pendingAction.kind}: ${previous.pendingAction.reason}`,
      ts: now,
      actionRequired: false,
    });
  }

  // Session went idle
  if (previous?.state !== "idle" && current.state === "idle") {
    notifications.push({
      type: "session_idle",
      title: "Session Idle",
      body: "Autonomy may start if enabled",
      ts: now,
      actionRequired: false,
    });
  }

  // Session became active
  if (previous?.state === "idle" && current.state !== "idle") {
    notifications.push({
      type: "session_active",
      title: "Session Active",
      body: current.latestTaskSummary,
      ts: now,
      actionRequired: false,
    });
  }

  // Dream completed
  if (
    current.dreamStatus?.consolidationStatus === "ready" &&
    previous?.dreamStatus?.consolidationStatus !== "ready"
  ) {
    notifications.push({
      type: "dream_completed",
      title: "Dream Completed",
      body: current.dreamStatus.lastDigestSummary ?? "Consolidation finished",
      ts: now,
      actionRequired: false,
    });
  }

  return notifications;
}
