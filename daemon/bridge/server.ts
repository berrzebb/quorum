/**
 * Bridge Server — transport-neutral remote state stream and control channel.
 *
 * Normalizes daemon snapshot + session ledger into a remote-consumable
 * state model. Transport (WebSocket, HTTP SSE, etc.) is pluggable.
 *
 * Core invariant: bridge failure never blocks local daemon or approval flow.
 *
 * @module daemon/bridge/server
 * @since RAI-1
 */

import type { EventStore } from "../../platform/bus/store.js";
import type { SessionLedger } from "../../platform/providers/session-ledger.js";
import type { ProviderSessionProjector } from "../../platform/bus/provider-session-projector.js";

// ── Remote State Model ───────────────────────

/**
 * Remote session state — authoritative for all remote consumers.
 * Maps local daemon concepts to a transport-neutral shape.
 */
export interface RemoteSessionState {
  /** Simplified tri-state for remote consumers. */
  state: "idle" | "running" | "requires_action";
  /** Session identifier. */
  sessionId: string;
  /** Pending approval, if any. */
  pendingAction: PendingAction | null;
  /** Latest task summary (short, for mobile). */
  latestTaskSummary: string;
  /** Active track progress. */
  activeTracks: RemoteTrackInfo[];
  /** Recent events (last N, for live feed). */
  recentEvents: RemoteEvent[];
  /** Consolidation/retro state. */
  dreamStatus: DreamStatus | null;
  /** Timestamp of this snapshot. */
  updatedAt: number;
}

export interface PendingAction {
  requestId: string;
  kind: "tool" | "command" | "diff" | "network";
  reason: string;
  tool: string;
  provider: string;
  sessionId: string;
  createdAt: number;
}

export interface RemoteTrackInfo {
  trackId: string;
  total: number;
  completed: number;
  status: string;
}

export interface RemoteEvent {
  type: string;
  timestamp: number;
  summary: string;
}

export interface DreamStatus {
  consolidationStatus: string;
  lastConsolidatedAt: number | null;
  lastDigestSummary: string | null;
}

// ── Bridge Transport Contract ────────────────

/**
 * Transport-neutral bridge interface.
 * Implementations can be WebSocket, HTTP SSE, local IPC, etc.
 */
export interface BridgeTransport {
  /** Transport name for logging. */
  readonly name: string;
  /** Start accepting connections. */
  start(): Promise<void>;
  /** Stop the transport. */
  stop(): Promise<void>;
  /** Push state snapshot to all connected clients. */
  broadcast(state: RemoteSessionState): void;
  /** Register a handler for incoming control messages. */
  onControl(handler: BridgeControlHandler): void;
  /** Number of connected clients. */
  clientCount(): number;
}

/**
 * Control message from remote client.
 */
export interface BridgeControlMessage {
  type: "approve" | "deny" | "cancel" | "ping" | "refresh";
  requestId?: string;
  actor?: string;
  signature?: string;
  ts: number;
}

export type BridgeControlHandler = (msg: BridgeControlMessage) => void;

// ── Bridge Server ────────────────────────────

/**
 * Bridge server — orchestrates state projection and control routing.
 */
export class BridgeServer {
  private transport: BridgeTransport | null = null;
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private controlHandlers: BridgeControlHandler[] = [];
  private lastBroadcastHash = "";

  constructor(
    private readonly store: EventStore,
    private readonly ledger: SessionLedger,
    private readonly projector: ProviderSessionProjector,
    private readonly options: BridgeServerOptions = {},
  ) {}

  /** Attach a transport and start broadcasting. */
  async start(transport: BridgeTransport): Promise<void> {
    this.transport = transport;
    transport.onControl((msg) => this.handleControl(msg));
    await transport.start();

    // Poll and broadcast state changes
    const intervalMs = this.options.pollIntervalMs ?? 1000;
    this.pollInterval = setInterval(() => {
      try { this.broadcastIfChanged(); } catch { /* bridge must not crash daemon */ }
    }, intervalMs);
  }

  /** Stop broadcasting and disconnect transport. */
  async stop(): Promise<void> {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    if (this.transport) {
      await this.transport.stop();
      this.transport = null;
    }
  }

  /** Register a handler for control messages (approval callbacks, etc.). */
  onControl(handler: BridgeControlHandler): void {
    this.controlHandlers.push(handler);
  }

  /** Get current remote state snapshot. */
  snapshot(): RemoteSessionState {
    return projectRemoteState(this.store, this.ledger, this.projector);
  }

  /** Check if bridge is connected and has clients. */
  isActive(): boolean {
    return this.transport != null && this.transport.clientCount() > 0;
  }

  // ── Private ──────────────────────────────

  private broadcastIfChanged(): void {
    if (!this.transport || this.transport.clientCount() === 0) return;

    const state = this.snapshot();
    const hash = `${state.state}:${state.pendingAction?.requestId ?? "none"}:${state.updatedAt}`;

    if (hash !== this.lastBroadcastHash) {
      this.lastBroadcastHash = hash;
      this.transport.broadcast(state);
    }
  }

  private handleControl(msg: BridgeControlMessage): void {
    for (const handler of this.controlHandlers) {
      try { handler(msg); } catch { /* control handler must not crash bridge */ }
    }
  }
}

export interface BridgeServerOptions {
  /** How often to poll and broadcast (ms). Default: 1000. */
  pollIntervalMs?: number;
}

// ── State Projection ─────────────────────────

/**
 * Project daemon + ledger + projector state into RemoteSessionState.
 * This is the single source of truth for remote consumers.
 */
export function projectRemoteState(
  store: EventStore,
  ledger: SessionLedger,
  projector: ProviderSessionProjector,
): RemoteSessionState {
  const now = Date.now();

  // Derive tri-state from active sessions and pending approvals
  const sessions = projector.projectAll();
  let state: RemoteSessionState["state"] = "idle";
  let pendingAction: PendingAction | null = null;

  for (const session of sessions) {
    if (session.pendingApprovals > 0) {
      state = "requires_action";
      // Get the actual pending approval details
      const approvals = ledger.pendingApprovals(session.providerSessionId);
      if (approvals.length > 0) {
        const a = approvals[0];
        pendingAction = {
          requestId: a.requestId,
          kind: a.kind as PendingAction["kind"],
          reason: a.reason ?? "",
          tool: a.reason ?? "",
          provider: session.provider,
          sessionId: session.quorumSessionId,
          createdAt: a.requestedAt ?? now,
        };
      }
      break;
    }
    if (session.state === "running") {
      state = "running";
    }
  }

  // Active tracks from event store
  const activeTracks: RemoteTrackInfo[] = [];
  const recentTrackEvents = store.recent(50).filter(e => e.type === "track.progress");
  const trackMap = new Map<string, RemoteTrackInfo>();
  for (const e of recentTrackEvents) {
    const p = e.payload as { trackId?: string; total?: number; completed?: number };
    if (p.trackId) {
      trackMap.set(p.trackId, {
        trackId: p.trackId,
        total: p.total ?? 0,
        completed: p.completed ?? 0,
        status: (p.completed ?? 0) >= (p.total ?? 1) ? "complete" : "in_progress",
      });
    }
  }
  activeTracks.push(...trackMap.values());

  // Recent events (compact for mobile)
  const recentEvents: RemoteEvent[] = store.recent(10).map(e => ({
    type: e.type,
    timestamp: e.timestamp,
    summary: summarizeEvent(e),
  }));

  // Dream status from KV
  const dreamKV = store.getKV("dream:state") as {
    consolidationStatus?: string;
    lastConsolidatedAt?: number;
    lastDigestId?: string;
  } | null;

  const dreamStatus: DreamStatus | null = dreamKV ? {
    consolidationStatus: dreamKV.consolidationStatus ?? "idle",
    lastConsolidatedAt: dreamKV.lastConsolidatedAt ?? null,
    lastDigestSummary: dreamKV.lastDigestId ?? null,
  } : null;

  // Latest task summary
  const latestAudit = store.recent(5).find(e => e.type === "audit.verdict");
  const latestTaskSummary = latestAudit
    ? `Audit: ${(latestAudit.payload as { verdict?: string }).verdict ?? "unknown"}`
    : sessions.length > 0 ? `${sessions.length} active session(s)` : "No active sessions";

  return {
    state,
    sessionId: sessions[0]?.quorumSessionId ?? "",
    pendingAction,
    latestTaskSummary,
    activeTracks,
    recentEvents,
    dreamStatus,
    updatedAt: now,
  };
}

// ── Helpers ──────────────────────────────────

function summarizeEvent(e: { type: string; payload: Record<string, unknown> }): string {
  const p = e.payload;
  switch (e.type) {
    case "audit.verdict": return `Audit: ${p.verdict ?? "unknown"}`;
    case "track.progress": return `Track ${p.trackId}: ${p.completed}/${p.total}`;
    case "agent.spawn": return `Agent: ${p.name} (${p.role})`;
    case "retro.complete": return "Retro completed";
    case "dream.consolidation.complete": return `Dream: ${p.summary ?? "done"}`;
    default: return e.type;
  }
}
