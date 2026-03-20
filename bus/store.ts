/**
 * Quorum Event Store — SQLite-backed persistent event storage.
 *
 * Ouroboros pattern: write from hooks/daemon, read from TUI — shared SQLite, no IPC.
 *
 * Schema mirrors Ouroboros's event_store.py:
 *   events (id, aggregate_type, aggregate_id, event_type, source, payload, timestamp)
 *
 * Supports:
 * - append / appendBatch (atomic multi-event insert)
 * - replay (ordered by timestamp + id for deterministic replay)
 * - query (flexible filtering by type, source, aggregate, time range)
 * - cursor-based pagination (getEventsAfter)
 * - phase-boundary transactions (UnitOfWork)
 */

import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { QuorumEvent, EventType, ProviderKind } from "./events.js";

export interface StoreOptions {
  /** Path to SQLite database file. */
  dbPath: string;
  /** Enable WAL mode for concurrent reads (default: true). */
  wal?: boolean;
}

export interface QueryFilter {
  eventType?: EventType;
  source?: ProviderKind;
  aggregateType?: string;
  aggregateId?: string;
  since?: number;
  until?: number;
  limit?: number;
  offset?: number;
}

export class EventStore {
  private db: Database.Database;

  constructor(opts: StoreOptions) {
    this.db = new Database(opts.dbPath);

    // WAL mode for concurrent read access (TUI reads while hooks write)
    if (opts.wal !== false) {
      this.db.pragma("journal_mode = WAL");
    }
    this.db.pragma("synchronous = NORMAL");

    this.createSchema();
  }

  private createSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        id            TEXT PRIMARY KEY,
        aggregate_type TEXT,
        aggregate_id  TEXT,
        event_type    TEXT NOT NULL,
        source        TEXT NOT NULL,
        session_id    TEXT,
        track_id      TEXT,
        agent_id      TEXT,
        payload       TEXT NOT NULL DEFAULT '{}',
        timestamp     INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_events_type
        ON events (event_type);
      CREATE INDEX IF NOT EXISTS idx_events_source
        ON events (source);
      CREATE INDEX IF NOT EXISTS idx_events_timestamp
        ON events (timestamp);
      CREATE INDEX IF NOT EXISTS idx_events_aggregate
        ON events (aggregate_type, aggregate_id, timestamp);
      CREATE INDEX IF NOT EXISTS idx_events_session
        ON events (session_id, timestamp);
    `);
  }

  /** Append a single event. */
  append(event: QuorumEvent): string {
    const id = randomUUID();
    this.db.prepare(`
      INSERT INTO events (id, aggregate_type, aggregate_id, event_type, source, session_id, track_id, agent_id, payload, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      event.payload.aggregateType as string ?? null,
      event.payload.aggregateId as string ?? null,
      event.type,
      event.source,
      event.sessionId ?? null,
      event.trackId ?? null,
      event.agentId ?? null,
      JSON.stringify(event.payload),
      event.timestamp,
    );
    return id;
  }

  /** Append multiple events atomically. */
  appendBatch(events: QuorumEvent[]): string[] {
    const ids: string[] = [];
    const insert = this.db.prepare(`
      INSERT INTO events (id, aggregate_type, aggregate_id, event_type, source, session_id, track_id, agent_id, payload, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const tx = this.db.transaction(() => {
      for (const event of events) {
        const id = randomUUID();
        insert.run(
          id,
          event.payload.aggregateType as string ?? null,
          event.payload.aggregateId as string ?? null,
          event.type,
          event.source,
          event.sessionId ?? null,
          event.trackId ?? null,
          event.agentId ?? null,
          JSON.stringify(event.payload),
          event.timestamp,
        );
        ids.push(id);
      }
    });
    tx();
    return ids;
  }

  /** Replay all events for an aggregate, ordered by timestamp + id. */
  replay(aggregateType: string, aggregateId: string): QuorumEvent[] {
    const rows = this.db.prepare(`
      SELECT * FROM events
      WHERE aggregate_type = ? AND aggregate_id = ?
      ORDER BY timestamp ASC, id ASC
    `).all(aggregateType, aggregateId) as EventRow[];

    return rows.map(rowToEvent);
  }

  /** Get events after a cursor (timestamp), for incremental polling. */
  getEventsAfter(sinceTimestamp: number, limit = 100): QuorumEvent[] {
    const rows = this.db.prepare(`
      SELECT * FROM events
      WHERE timestamp > ?
      ORDER BY timestamp ASC, id ASC
      LIMIT ?
    `).all(sinceTimestamp, limit) as EventRow[];

    return rows.map(rowToEvent);
  }

  /** Flexible query with filters. */
  query(filter: QueryFilter = {}): QuorumEvent[] {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filter.eventType) {
      conditions.push("event_type = ?");
      params.push(filter.eventType);
    }
    if (filter.source) {
      conditions.push("source = ?");
      params.push(filter.source);
    }
    if (filter.aggregateType) {
      conditions.push("aggregate_type = ?");
      params.push(filter.aggregateType);
    }
    if (filter.aggregateId) {
      conditions.push("aggregate_id = ?");
      params.push(filter.aggregateId);
    }
    if (filter.since) {
      conditions.push("timestamp >= ?");
      params.push(filter.since);
    }
    if (filter.until) {
      conditions.push("timestamp <= ?");
      params.push(filter.until);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = filter.limit ? `LIMIT ${filter.limit}` : "";
    const offset = filter.offset ? `OFFSET ${filter.offset}` : "";

    const rows = this.db.prepare(`
      SELECT * FROM events ${where}
      ORDER BY timestamp ASC, id ASC
      ${limit} ${offset}
    `).all(...params) as EventRow[];

    return rows.map(rowToEvent);
  }

  /** Get most recent N events. */
  recent(count = 50): QuorumEvent[] {
    const rows = this.db.prepare(`
      SELECT * FROM events
      ORDER BY timestamp DESC, id DESC
      LIMIT ?
    `).all(count) as EventRow[];

    return rows.reverse().map(rowToEvent);
  }

  /** Count events matching a filter. */
  count(filter: QueryFilter = {}): number {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filter.eventType) {
      conditions.push("event_type = ?");
      params.push(filter.eventType);
    }
    if (filter.source) {
      conditions.push("source = ?");
      params.push(filter.source);
    }
    if (filter.since) {
      conditions.push("timestamp >= ?");
      params.push(filter.since);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const row = this.db.prepare(`SELECT COUNT(*) as cnt FROM events ${where}`).get(...params) as { cnt: number };
    return row.cnt;
  }

  /** Close the database connection. */
  close(): void {
    this.db.close();
  }
}

// ── Phase-boundary UnitOfWork ─────────────────

export class UnitOfWork {
  private pending: QuorumEvent[] = [];
  private store: EventStore;

  constructor(store: EventStore) {
    this.store = store;
  }

  /** Stage an event (not yet persisted). */
  stage(event: QuorumEvent): void {
    this.pending.push(event);
  }

  /** Commit all staged events atomically. */
  commit(): string[] {
    const ids = this.store.appendBatch(this.pending);
    this.pending = [];
    return ids;
  }

  /** Discard all staged events. */
  rollback(): void {
    this.pending = [];
  }

  /** Number of staged events. */
  get size(): number {
    return this.pending.length;
  }
}

// ── Internal helpers ──────────────────────────

interface EventRow {
  id: string;
  aggregate_type: string | null;
  aggregate_id: string | null;
  event_type: string;
  source: string;
  session_id: string | null;
  track_id: string | null;
  agent_id: string | null;
  payload: string;
  timestamp: number;
}

function rowToEvent(row: EventRow): QuorumEvent {
  return {
    type: row.event_type as EventType,
    source: row.source as ProviderKind,
    timestamp: row.timestamp,
    sessionId: row.session_id ?? undefined,
    trackId: row.track_id ?? undefined,
    agentId: row.agent_id ?? undefined,
    payload: JSON.parse(row.payload),
  };
}
