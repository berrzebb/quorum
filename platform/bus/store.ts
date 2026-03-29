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
import { writeFileSync, renameSync, rmSync } from "node:fs";
import type { QuorumEvent, EventType, ProviderKind } from "./events.js";

export interface StoreOptions {
  /** Path to SQLite database file. */
  dbPath: string;
  /** Enable WAL mode for concurrent reads (default: true). */
  wal?: boolean;
}

// ── State management types ───────────────────

export interface StateTransition {
  entityType: string;
  entityId: string;
  fromState?: string | null;
  toState: string;
  source: string;
  sessionId?: string;
  metadata?: Record<string, unknown>;
}

export interface KVEntry {
  key: string;
  value: unknown;
}

export interface FileProjection {
  path: string;
  content: string;
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
  /** When true, results are ordered newest-first (DESC). Default is oldest-first (ASC). */
  descending?: boolean;
}

export class EventStore {
  private db: Database.Database;

  // ── Cached prepared statements (compiled once, reused on every call) ──
  private stmtAppend!: Database.Statement;
  private stmtCurrentState!: Database.Statement;
  private stmtGetKV!: Database.Statement;
  private stmtSetKV!: Database.Statement;
  private stmtReplay!: Database.Statement;
  private stmtEventsAfter!: Database.Statement;
  private stmtRecent!: Database.Statement;
  private stmtInsertTransition!: Database.Statement;

  /** Cache for dynamically-built query/count prepared statements (keyed by filter shape). */
  private queryCache = new Map<string, Database.Statement>();
  private countCache = new Map<string, Database.Statement>();

  constructor(opts: StoreOptions) {
    this.db = new Database(opts.dbPath);

    // WAL mode for concurrent read access (TUI reads while hooks write)
    if (opts.wal !== false) {
      this.db.pragma("journal_mode = WAL");
    }
    this.db.pragma("synchronous = NORMAL");

    this.createSchema();
    this.prepareStatements();
  }

  private prepareStatements(): void {
    this.stmtAppend = this.db.prepare(`
      INSERT INTO events (id, aggregate_type, aggregate_id, event_type, source, session_id, track_id, agent_id, payload, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.stmtCurrentState = this.db.prepare(`
      SELECT to_state FROM state_transitions
      WHERE entity_type = ? AND entity_id = ?
      ORDER BY created_at DESC LIMIT 1
    `);
    this.stmtGetKV = this.db.prepare(
      `SELECT value FROM kv_state WHERE key = ?`
    );
    this.stmtSetKV = this.db.prepare(
      `INSERT OR REPLACE INTO kv_state (key, value, updated_at) VALUES (?, ?, ?)`
    );
    this.stmtReplay = this.db.prepare(`
      SELECT * FROM events
      WHERE aggregate_type = ? AND aggregate_id = ?
      ORDER BY timestamp ASC, id ASC
    `);
    this.stmtEventsAfter = this.db.prepare(`
      SELECT * FROM events
      WHERE timestamp > ?
      ORDER BY timestamp ASC, id ASC
      LIMIT ?
    `);
    this.stmtRecent = this.db.prepare(`
      SELECT * FROM events
      ORDER BY timestamp DESC, id DESC
      LIMIT ?
    `);
    this.stmtInsertTransition = this.db.prepare(`
      INSERT INTO state_transitions (id, entity_type, entity_id, from_state, to_state, source, session_id, metadata, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
  }

  /** Expose the raw database handle (for LockService, StateReader). */
  getDb(): Database.Database {
    return this.db;
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

      -- State transitions: source of truth for tag-based state machines
      CREATE TABLE IF NOT EXISTS state_transitions (
        id            TEXT PRIMARY KEY,
        entity_type   TEXT NOT NULL,
        entity_id     TEXT NOT NULL,
        from_state    TEXT,
        to_state      TEXT NOT NULL,
        source        TEXT NOT NULL,
        session_id    TEXT,
        metadata      TEXT NOT NULL DEFAULT '{}',
        created_at    INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_st_entity
        ON state_transitions (entity_type, entity_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_st_state
        ON state_transitions (to_state, created_at);

      -- Locks: atomic lock acquisition (replaces JSON lock files)
      CREATE TABLE IF NOT EXISTS locks (
        lock_name     TEXT PRIMARY KEY,
        owner_pid     INTEGER NOT NULL,
        owner_session TEXT,
        acquired_at   INTEGER NOT NULL,
        ttl_ms        INTEGER NOT NULL DEFAULT 1800000
      );

      -- KV state: general-purpose key-value store (replaces marker/session JSON files)
      CREATE TABLE IF NOT EXISTS kv_state (
        key           TEXT PRIMARY KEY,
        value         TEXT NOT NULL,
        updated_at    INTEGER NOT NULL
      );

      -- File claims: per-file ownership for worktree conflict prevention
      CREATE TABLE IF NOT EXISTS file_claims (
        file_path     TEXT PRIMARY KEY,
        agent_id      TEXT NOT NULL,
        session_id    TEXT,
        claimed_at    INTEGER NOT NULL,
        ttl_ms        INTEGER NOT NULL DEFAULT 600000
      );
      CREATE INDEX IF NOT EXISTS idx_fc_agent
        ON file_claims (agent_id);
    `);

    // Views — use separate exec() calls since CREATE VIEW IF NOT EXISTS
    // combined with other DDL can cause issues on some SQLite versions
    try {
      this.db.exec(`
        CREATE VIEW IF NOT EXISTS v_current_item_states AS
          SELECT entity_id, to_state AS current_state, source, metadata, created_at
          FROM state_transitions st1
          WHERE entity_type = 'audit_item'
            AND created_at = (
              SELECT MAX(created_at) FROM state_transitions st2
              WHERE st2.entity_type = st1.entity_type
                AND st2.entity_id = st1.entity_id
            );
      `);
    } catch { /* view already exists */ }

    try {
      this.db.exec(`
        CREATE VIEW IF NOT EXISTS v_active_locks AS
          SELECT * FROM locks
          WHERE acquired_at + ttl_ms > (CAST(strftime('%s', 'now') AS INTEGER) * 1000);
      `);
    } catch { /* view already exists */ }
  }

  /** Build the parameter tuple for stmtAppend. */
  private _eventParams(id: string, event: QuorumEvent): unknown[] {
    return [
      id,
      (event.payload.aggregateType ?? null) as string | null,
      (event.payload.aggregateId ?? null) as string | null,
      event.type,
      event.source,
      event.sessionId ?? null,
      event.trackId ?? null,
      event.agentId ?? null,
      JSON.stringify(event.payload),
      event.timestamp,
    ];
  }

  /** Append a single event. */
  append(event: QuorumEvent): string {
    const id = randomUUID();
    this.stmtAppend.run(...this._eventParams(id, event));
    return id;
  }

  /** Append multiple events atomically. */
  appendBatch(events: QuorumEvent[]): string[] {
    const ids: string[] = [];

    const tx = this.db.transaction(() => {
      for (const event of events) {
        const id = randomUUID();
        this.stmtAppend.run(...this._eventParams(id, event));
        ids.push(id);
      }
    });
    tx();
    return ids;
  }

  /** Replay all events for an aggregate, ordered by timestamp + id. */
  replay(aggregateType: string, aggregateId: string): QuorumEvent[] {
    const rows = this.stmtReplay.all(aggregateType, aggregateId) as EventRow[];
    return rows.map(rowToEvent);
  }

  /** Get events after a cursor (timestamp), for incremental polling. */
  getEventsAfter(sinceTimestamp: number, limit = 100): QuorumEvent[] {
    const rows = this.stmtEventsAfter.all(sinceTimestamp, limit) as EventRow[];
    return rows.map(rowToEvent);
  }

  /** Flexible query with filters. Uses cached prepared statements. */
  query(filter: QueryFilter = {}): QuorumEvent[] {
    const { cacheKey, conditions, params } = this._buildFilterSQL(filter);
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const hasLimit = filter.limit != null;
    const hasOffset = hasLimit && filter.offset != null;
    const suffix = hasLimit ? ` LIMIT ?${hasOffset ? " OFFSET ?" : ""}` : "";
    const desc = filter.descending ?? false;
    const order = desc ? "DESC" : "ASC";

    const stmtKey = `q:${cacheKey}:${hasLimit}:${hasOffset}:${desc}`;
    let stmt = this.queryCache.get(stmtKey);
    if (!stmt) {
      stmt = this.db.prepare(`
        SELECT * FROM events ${where}
        ORDER BY timestamp ${order}, id ${order}${suffix}
      `);
      this.queryCache.set(stmtKey, stmt);
    }

    if (hasLimit) params.push(filter.limit!);
    if (hasOffset) params.push(filter.offset!);
    const rows = stmt.all(...params) as EventRow[];
    return rows.map(rowToEvent);
  }

  /** Get most recent N events. */
  recent(count = 50): QuorumEvent[] {
    const rows = this.stmtRecent.all(count) as EventRow[];
    return rows.reverse().map(rowToEvent);
  }

  /** Count events matching a filter. Uses cached prepared statements. */
  count(filter: QueryFilter = {}): number {
    const { cacheKey, conditions, params } = this._buildFilterSQL(filter);
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    let stmt = this.countCache.get(cacheKey);
    if (!stmt) {
      stmt = this.db.prepare(`SELECT COUNT(*) as cnt FROM events ${where}`);
      this.countCache.set(cacheKey, stmt);
    }

    const row = stmt.get(...params) as { cnt: number };
    return row.cnt;
  }

  /** Build SQL conditions and a cache key from a filter. Shared by query() and count(). */
  private _buildFilterSQL(filter: QueryFilter): {
    cacheKey: string; conditions: string[]; params: unknown[];
  } {
    const conditions: string[] = [];
    const params: unknown[] = [];
    const keyParts: string[] = [];

    if (filter.eventType) { conditions.push("event_type = ?"); params.push(filter.eventType); keyParts.push("t"); }
    if (filter.source) { conditions.push("source = ?"); params.push(filter.source); keyParts.push("s"); }
    if (filter.aggregateType) { conditions.push("aggregate_type = ?"); params.push(filter.aggregateType); keyParts.push("at"); }
    if (filter.aggregateId) { conditions.push("aggregate_id = ?"); params.push(filter.aggregateId); keyParts.push("ai"); }
    if (filter.since) { conditions.push("timestamp >= ?"); params.push(filter.since); keyParts.push("si"); }
    if (filter.until) { conditions.push("timestamp <= ?"); params.push(filter.until); keyParts.push("un"); }

    return { cacheKey: keyParts.join("+") || "_", conditions, params };
  }

  /**
   * Atomic multi-table commit: events + state transitions + KV updates.
   * All succeed or all fail within a single SQLite transaction.
   */
  commitTransaction(
    events: QuorumEvent[],
    transitions: StateTransition[],
    kvUpdates: KVEntry[],
  ): string[] {
    const ids: string[] = [];
    const now = Date.now();

    const tx = this.db.transaction(() => {
      for (const event of events) {
        const id = randomUUID();
        this.stmtAppend.run(...this._eventParams(id, event));
        ids.push(id);
      }

      for (const st of transitions) {
        this.stmtInsertTransition.run(
          randomUUID(),
          st.entityType,
          st.entityId,
          st.fromState ?? null,
          st.toState,
          st.source,
          st.sessionId ?? null,
          JSON.stringify(st.metadata ?? {}),
          now,
        );
      }

      for (const kv of kvUpdates) {
        this.stmtSetKV.run(kv.key, JSON.stringify(kv.value), now);
      }
    });

    tx();
    return ids;
  }

  /** Query current state for an entity (latest transition). */
  currentState(entityType: string, entityId: string): string | null {
    const row = this.stmtCurrentState.get(entityType, entityId) as { to_state: string } | undefined;
    return row?.to_state ?? null;
  }

  /** Read a KV entry. */
  getKV(key: string): unknown | null {
    const row = this.stmtGetKV.get(key) as { value: string } | undefined;
    if (!row) return null;
    try { return JSON.parse(row.value); } catch { return null; }
  }

  /** Write a KV entry. */
  setKV(key: string, value: unknown): void {
    this.stmtSetKV.run(key, JSON.stringify(value), Date.now());
  }

  /** Close the database connection. */
  close(): void {
    this.queryCache.clear();
    this.countCache.clear();
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

// ── Transactional UnitOfWork (SQLite + file projections) ───

export class TransactionalUnitOfWork {
  private pendingEvents: QuorumEvent[] = [];
  private pendingTransitions: StateTransition[] = [];
  private pendingKV: KVEntry[] = [];
  private pendingProjections: FileProjection[] = [];
  private store: EventStore;

  constructor(store: EventStore) {
    this.store = store;
  }

  stageEvent(event: QuorumEvent): void {
    this.pendingEvents.push(event);
  }

  stageTransition(transition: StateTransition): void {
    this.pendingTransitions.push(transition);
  }

  stageKV(key: string, value: unknown): void {
    this.pendingKV.push({ key, value });
  }

  stageProjection(projection: FileProjection): void {
    this.pendingProjections.push(projection);
  }

  /**
   * Atomic commit: SQLite transaction + file projections.
   *
   * Order:
   * 1. Write projections to .quorum-tmp files
   * 2. SQLite transaction: events + transitions + kv_state
   * 3. Rename .quorum-tmp → target (atomic on POSIX, near-atomic on NTFS)
   * 4. SQLite failure → delete tmp files (zero side effects)
   * 5. Rename failure → SQLite is truth, files self-heal on next cycle
   */
  commit(): string[] {
    // Phase 1: write temp files (can fail without side effects)
    const tempPaths: { tmp: string; target: string }[] = [];
    for (const proj of this.pendingProjections) {
      const tmp = proj.path + ".quorum-tmp";
      writeFileSync(tmp, proj.content, "utf8");
      tempPaths.push({ tmp, target: proj.path });
    }

    // Phase 2: SQLite transaction (atomic)
    let eventIds: string[];
    try {
      eventIds = this.store.commitTransaction(
        this.pendingEvents,
        this.pendingTransitions,
        this.pendingKV,
      );
    } catch (err) {
      // Rollback: clean temp files
      for (const { tmp } of tempPaths) {
        try { rmSync(tmp, { force: true }); } catch { /* best-effort */ }
      }
      throw err;
    }

    // Phase 3: rename temp → target
    for (const { tmp, target } of tempPaths) {
      try {
        renameSync(tmp, target);
      } catch {
        // Non-fatal: SQLite is truth, projection will regenerate
      }
    }

    this.clear();
    return eventIds;
  }

  rollback(): void {
    this.clear();
  }

  get size(): number {
    return this.pendingEvents.length + this.pendingTransitions.length +
      this.pendingKV.length + this.pendingProjections.length;
  }

  private clear(): void {
    this.pendingEvents = [];
    this.pendingTransitions = [];
    this.pendingKV = [];
    this.pendingProjections = [];
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
