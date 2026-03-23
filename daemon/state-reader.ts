/**
 * StateReader — reads all quorum state from SQLite exclusively.
 *
 * Replaces the file-scraping bootstrapFromFiles() approach.
 * The daemon TUI uses this to display current state without
 * parsing markdown files, JSON locks, or retro markers.
 *
 * All state is derived from:
 * - state_transitions table (item states, gate states)
 * - locks table (audit locks)
 * - kv_state table (retro markers, session IDs)
 * - events table (recent events, specialist reviews, track progress)
 */

import type { EventStore } from "../bus/store.js";
import type { LockInfo } from "../bus/lock.js";
import type { QuorumEvent } from "../bus/events.js";

// ── Types ────────────────────────────────────

export interface GateInfo {
  name: string;
  status: "open" | "blocked" | "pending" | "error";
  detail?: string;
  since?: number;
}

export interface ItemStateInfo {
  entityId: string;
  currentState: string;
  source: string;
  label?: string;
  updatedAt: number;
}

export interface SpecialistInfo {
  domain: string;
  tool?: string;
  toolStatus?: string;
  agent?: string;
  agentVerdict?: string;
  timestamp: number;
}

export interface TrackInfo {
  trackId: string;
  total: number;
  completed: number;
  pending: number;
  blocked: number;
  lastUpdate: number;
}

export interface FullState {
  gates: GateInfo[];
  items: ItemStateInfo[];
  locks: LockInfo[];
  specialists: SpecialistInfo[];
  tracks: TrackInfo[];
  recentEvents: QuorumEvent[];
}

// ── StateReader ──────────────────────────────

export class StateReader {
  private store: EventStore;

  constructor(store: EventStore) {
    this.store = store;
  }

  /**
   * Read all state in one call — efficient for TUI polling.
   */
  readAll(eventLimit = 20): FullState {
    return {
      gates: this.gateStatus(),
      items: this.itemStates(),
      locks: this.activeLocks(),
      specialists: this.activeSpecialists(),
      tracks: this.trackProgress(),
      recentEvents: this.recentEvents(eventLimit),
    };
  }

  /**
   * 3 enforcement gates derived from SQLite state.
   */
  gateStatus(): GateInfo[] {
    const gates: GateInfo[] = [];

    // Audit gate: latest gate transition
    const auditState = this.latestTransition("gate", "audit");
    gates.push({
      name: "Audit",
      status: auditState
        ? (auditState.to_state === "approved" ? "open"
          : auditState.to_state === "pending" ? "pending"
          : auditState.to_state === "infra_failure" ? "error"
          : "blocked")
        : "open",
      detail: auditState?.to_state,
      since: auditState?.created_at,
    });

    // Retro gate: from kv_state
    const retroMarker = this.store.getKV("retro:marker") as { retro_pending?: boolean; completed_at?: string } | null;
    gates.push({
      name: "Retro",
      status: retroMarker?.retro_pending ? "blocked" : "open",
      detail: retroMarker?.retro_pending ? "retrospective pending" : undefined,
    });

    // Quality gate: recent quality.fail events in last 5 minutes
    const fiveMinAgo = Date.now() - 300_000;
    const qualityFails = this.store.count({
      eventType: "quality.fail" as any,
      since: fiveMinAgo,
    });
    gates.push({
      name: "Quality",
      status: qualityFails > 0 ? "blocked" : "open",
      detail: qualityFails > 0 ? `${qualityFails} recent failure(s)` : undefined,
    });

    return gates;
  }

  /**
   * Current state of every tracked audit item.
   */
  itemStates(): ItemStateInfo[] {
    try {
      const db = this.store.getDb();
      const rows = db.prepare(`
        SELECT entity_id, to_state, source, metadata, created_at
        FROM state_transitions st1
        WHERE entity_type = 'audit_item'
          AND rowid = (
            SELECT rowid FROM state_transitions st2
            WHERE st2.entity_type = st1.entity_type
              AND st2.entity_id = st1.entity_id
            ORDER BY st2.created_at DESC, st2.rowid DESC
            LIMIT 1
          )
        ORDER BY created_at DESC
      `).all() as Array<{
        entity_id: string;
        to_state: string;
        source: string;
        metadata: string;
        created_at: number;
      }>;

      return rows.map(r => {
        const meta = JSON.parse(r.metadata);
        return {
          entityId: r.entity_id,
          currentState: r.to_state,
          source: r.source,
          label: meta.label as string | undefined,
          updatedAt: r.created_at,
        };
      });
    } catch {
      return [];
    }
  }

  /**
   * Active (non-expired) locks.
   */
  activeLocks(): LockInfo[] {
    try {
      const db = this.store.getDb();
      const now = Date.now();
      const rows = db.prepare(
        `SELECT * FROM locks WHERE acquired_at + ttl_ms > ?`
      ).all(now) as Array<{
        lock_name: string;
        owner_pid: number;
        owner_session: string | null;
        acquired_at: number;
        ttl_ms: number;
      }>;

      return rows.map(r => ({
        held: true,
        lockName: r.lock_name,
        owner: r.owner_pid,
        ownerSession: r.owner_session ?? undefined,
        acquiredAt: r.acquired_at,
        ttlMs: r.ttl_ms,
      }));
    } catch {
      return [];
    }
  }

  /**
   * Active specialist domain reviews from recent events.
   */
  activeSpecialists(): SpecialistInfo[] {
    try {
      const specialists: SpecialistInfo[] = [];
      const recentDetect = this.store.query({
        eventType: "specialist.detect" as any,
        limit: 5,
      });
      const recentTool = this.store.query({
        eventType: "specialist.tool" as any,
        limit: 20,
      });
      const recentReview = this.store.query({
        eventType: "specialist.review" as any,
        limit: 20,
      });

      // Build a map of domain → latest info
      const domainMap = new Map<string, SpecialistInfo>();

      for (const evt of recentTool) {
        const p = evt.payload;
        const domain = p.domain as string;
        domainMap.set(domain, {
          domain,
          tool: p.tool as string,
          toolStatus: p.status as string,
          timestamp: evt.timestamp,
        });
      }

      for (const evt of recentReview) {
        const p = evt.payload;
        const domain = p.domain as string;
        const existing = domainMap.get(domain);
        if (existing) {
          existing.agent = p.agent as string;
          existing.agentVerdict = p.verdict as string;
          existing.timestamp = Math.max(existing.timestamp, evt.timestamp);
        } else {
          domainMap.set(domain, {
            domain,
            agent: p.agent as string,
            agentVerdict: p.verdict as string,
            timestamp: evt.timestamp,
          });
        }
      }

      return [...domainMap.values()].sort((a, b) => b.timestamp - a.timestamp);
    } catch {
      return [];
    }
  }

  /**
   * Track progress from track.progress events.
   */
  trackProgress(): TrackInfo[] {
    try {
      const trackEvents = this.store.query({
        eventType: "track.progress" as any,
        limit: 100,
      });

      // Latest per track
      const trackMap = new Map<string, TrackInfo>();
      for (const evt of trackEvents) {
        const p = evt.payload;
        const trackId = (p.trackId ?? evt.trackId ?? "unknown") as string;
        trackMap.set(trackId, {
          trackId,
          total: (p.total ?? 0) as number,
          completed: (p.completed ?? 0) as number,
          pending: (p.pending ?? 0) as number,
          blocked: (p.blocked ?? 0) as number,
          lastUpdate: evt.timestamp,
        });
      }

      return [...trackMap.values()].sort((a, b) => b.lastUpdate - a.lastUpdate);
    } catch {
      return [];
    }
  }

  /**
   * Recent events for the audit stream.
   */
  recentEvents(limit = 20): QuorumEvent[] {
    return this.store.recent(limit);
  }

  /**
   * Changes since a timestamp — for incremental TUI updates.
   */
  changesSince(timestamp: number): {
    events: QuorumEvent[];
    hasStateChanges: boolean;
  } {
    const events = this.store.getEventsAfter(timestamp);
    const hasStateChanges = events.some(e =>
      e.type.startsWith("audit.") ||
      e.type.startsWith("retro.") ||
      e.type.startsWith("specialist.") ||
      e.type.startsWith("track."),
    );
    return { events, hasStateChanges };
  }

  // ── Private helpers ──────────────────────

  private latestTransition(entityType: string, entityId: string): {
    to_state: string;
    created_at: number;
  } | null {
    try {
      const db = this.store.getDb();
      return db.prepare(`
        SELECT to_state, created_at FROM state_transitions
        WHERE entity_type = ? AND entity_id = ?
        ORDER BY created_at DESC, rowid DESC
        LIMIT 1
      `).get(entityType, entityId) as { to_state: string; created_at: number } | undefined ?? null;
    } catch {
      return null;
    }
  }
}
