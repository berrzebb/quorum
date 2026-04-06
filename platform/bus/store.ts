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

import { openDatabase, type SQLiteDatabase, type SQLiteStatement } from "./sqlite-adapter.js";
import { randomUUID, createHash } from "node:crypto";
import { writeFileSync, renameSync, rmSync } from "node:fs";
import type { QuorumEvent, EventType, ProviderKind } from "./events.js";
import { runGraphMigration, type GraphMigrationReport } from "./graph-migrate.js";

// ── Hash Chain (v0.6.3) ─────────────────────────────

/** Genesis hash — the seed for the hash chain. */
export const GENESIS_HASH = createHash("sha256").update("quorum-genesis").digest("hex");

/**
 * Compute the SHA-256 hash for an event in the chain.
 * hash = SHA-256(prevHash | eventType | payload | timestamp)
 */
export function computeEventHash(
  prevHash: string,
  eventType: string,
  payload: string,
  timestamp: number,
): string {
  return createHash("sha256")
    .update(`${prevHash}|${eventType}|${payload}|${timestamp}`)
    .digest("hex");
}

/** Result of chain verification. */
export interface ChainVerifyResult {
  valid: boolean;
  checked: number;
  skipped: number;
  brokenAt?: string;
  expected?: string;
  actual?: string;
}

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
  private db: SQLiteDatabase;

  // ── Cached prepared statements (compiled once, reused on every call) ──
  private stmtAppend!: SQLiteStatement;
  private stmtCurrentState!: SQLiteStatement;
  private stmtGetKV!: SQLiteStatement;
  private stmtSetKV!: SQLiteStatement;
  private stmtReplay!: SQLiteStatement;
  private stmtEventsAfter!: SQLiteStatement;
  private stmtRecent!: SQLiteStatement;
  private stmtInsertTransition!: SQLiteStatement;

  /** Cache for dynamically-built query/count prepared statements (keyed by filter shape). */
  private queryCache = new Map<string, SQLiteStatement>();
  private countCache = new Map<string, SQLiteStatement>();

  /** v0.6.5 graph migration report (available after construction). */
  graphMigration?: GraphMigrationReport;

  constructor(opts: StoreOptions) {
    this.db = openDatabase(opts.dbPath);

    // WAL mode for concurrent read access (TUI reads while hooks write)
    if (opts.wal !== false) {
      this.db.pragma("journal_mode = WAL");
    }
    this.db.pragma("synchronous = NORMAL");

    this.createSchema();
    this.migrateHashColumns();
    this.migrateGraph();
    this.prepareStatements();
  }

  private prepareStatements(): void {
    this.stmtAppend = this.db.prepare(`
      INSERT INTO events (id, aggregate_type, aggregate_id, event_type, source, session_id, track_id, agent_id, payload, timestamp, prev_hash, hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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

  /**
   * v0.6.3: Migrate existing DB to add hash chain columns.
   * Safe to call on new DBs (columns already exist from createSchema).
   */
  private migrateHashColumns(): void {
    try {
      const cols = this.db.pragma("table_info(events)") as Array<{ name: string }>;
      const hasHash = cols.some(c => c.name === "hash");
      if (!hasHash) {
        this.db.exec(`ALTER TABLE events ADD COLUMN prev_hash TEXT DEFAULT NULL`);
        this.db.exec(`ALTER TABLE events ADD COLUMN hash TEXT DEFAULT NULL`);
      }
    } catch { /* migration is best-effort */ }
  }

  /**
   * v0.6.5: Run graph migrations (entity columns, FTS5, facts migration).
   * Safe to call on every startup — all migrations are idempotent.
   */
  private migrateGraph(): void {
    try {
      this.graphMigration = runGraphMigration(this.db);
    } catch { /* graph migration is best-effort */ }
  }

  /** Expose the raw database handle (for LockService, StateReader). */
  getDb(): SQLiteDatabase {
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
        timestamp     INTEGER NOT NULL,
        prev_hash     TEXT DEFAULT NULL,
        hash          TEXT DEFAULT NULL
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

      -- Graph entities: semantic impact graph nodes (v0.6.0 GRAPH track)
      CREATE TABLE IF NOT EXISTS entities (
        id          TEXT PRIMARY KEY,
        type        TEXT NOT NULL,
        title       TEXT NOT NULL,
        description TEXT,
        status      TEXT NOT NULL DEFAULT 'draft',
        metadata    TEXT NOT NULL DEFAULT '{}',
        created_at  INTEGER NOT NULL,
        updated_at  INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_entities_type
        ON entities (type);
      CREATE INDEX IF NOT EXISTS idx_entities_status
        ON entities (status);

      -- Graph relations: typed edges between entities (v0.6.0 GRAPH track)
      CREATE TABLE IF NOT EXISTS relations (
        id          TEXT PRIMARY KEY,
        from_id     TEXT NOT NULL,
        to_id       TEXT NOT NULL,
        type        TEXT NOT NULL,
        weight      REAL NOT NULL DEFAULT 1.0,
        metadata    TEXT NOT NULL DEFAULT '{}',
        created_at  INTEGER NOT NULL,
        FOREIGN KEY (from_id) REFERENCES entities(id),
        FOREIGN KEY (to_id) REFERENCES entities(id)
      );
      CREATE INDEX IF NOT EXISTS idx_relations_from
        ON relations (from_id);
      CREATE INDEX IF NOT EXISTS idx_relations_to
        ON relations (to_id);
      CREATE INDEX IF NOT EXISTS idx_relations_type
        ON relations (type);

      -- Graph history: changeset tracking for entity/relation modifications
      CREATE TABLE IF NOT EXISTS changesets (
        id          TEXT PRIMARY KEY,
        source      TEXT NOT NULL DEFAULT 'manual',
        description TEXT,
        created_at  INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS entity_changes (
        id            TEXT PRIMARY KEY,
        changeset_id  TEXT NOT NULL,
        entity_id     TEXT NOT NULL,
        action        TEXT NOT NULL,
        before_data   TEXT,
        after_data    TEXT,
        FOREIGN KEY (changeset_id) REFERENCES changesets(id)
      );
      CREATE INDEX IF NOT EXISTS idx_entity_changes_changeset
        ON entity_changes (changeset_id);
      CREATE INDEX IF NOT EXISTS idx_entity_changes_entity
        ON entity_changes (entity_id);
      CREATE TABLE IF NOT EXISTS relation_changes (
        id            TEXT PRIMARY KEY,
        changeset_id  TEXT NOT NULL,
        relation_id   TEXT NOT NULL,
        action        TEXT NOT NULL,
        before_data   TEXT,
        after_data    TEXT,
        FOREIGN KEY (changeset_id) REFERENCES changesets(id)
      );
      CREATE INDEX IF NOT EXISTS idx_relation_changes_changeset
        ON relation_changes (changeset_id);
      CREATE INDEX IF NOT EXISTS idx_relation_changes_relation
        ON relation_changes (relation_id);

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

      -- Facts: cross-session learning store (v0.6.4 FACT track)
      CREATE TABLE IF NOT EXISTS facts (
        id          TEXT PRIMARY KEY,
        scope       TEXT NOT NULL DEFAULT 'project',
        category    TEXT NOT NULL,
        content     TEXT NOT NULL,
        frequency   INTEGER NOT NULL DEFAULT 1,
        status      TEXT NOT NULL DEFAULT 'candidate',
        project_id  TEXT,
        created_at  INTEGER NOT NULL,
        updated_at  INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_facts_status
        ON facts (status);
      CREATE INDEX IF NOT EXISTS idx_facts_scope
        ON facts (scope);
      CREATE INDEX IF NOT EXISTS idx_facts_project
        ON facts (project_id);
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
    } catch (err) { console.warn(`[store] v_current_item_states view creation failed: ${(err as Error).message}`); }

    try {
      this.db.exec(`
        CREATE VIEW IF NOT EXISTS v_active_locks AS
          SELECT * FROM locks
          WHERE acquired_at + ttl_ms > (CAST(strftime('%s', 'now') AS INTEGER) * 1000);
      `);
    } catch (err) { console.warn(`[store] v_active_locks view creation failed: ${(err as Error).message}`); }
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

  /** Get the hash of the last event in the chain (or genesis hash). */
  private getLastHash(): string {
    try {
      const row = this.db.prepare(
        `SELECT hash FROM events WHERE hash IS NOT NULL ORDER BY rowid DESC LIMIT 1`,
      ).get() as { hash: string } | undefined;
      return row?.hash ?? GENESIS_HASH;
    } catch {
      return GENESIS_HASH;
    }
  }

  /** Append a single event with hash chain linking. */
  append(event: QuorumEvent): string {
    const id = randomUUID();
    const payload = JSON.stringify(event.payload);
    const prevHash = this.getLastHash();
    const hash = computeEventHash(prevHash, event.type, payload, event.timestamp);
    this.stmtAppend.run(...this._eventParams(id, event), prevHash, hash);
    return id;
  }

  /** Append multiple events atomically with chain-linked hashes. */
  appendBatch(events: QuorumEvent[]): string[] {
    const ids: string[] = [];

    const tx = this.db.transaction(() => {
      let prevHash = this.getLastHash();
      for (const event of events) {
        const id = randomUUID();
        const payload = JSON.stringify(event.payload);
        const hash = computeEventHash(prevHash, event.type, payload, event.timestamp);
        this.stmtAppend.run(...this._eventParams(id, event), prevHash, hash);
        ids.push(id);
        prevHash = hash;
      }
    });
    tx();
    return ids;
  }

  /**
   * v0.6.3: Verify the hash chain integrity.
   *
   * Scans events in order, recomputes each hash, and compares with stored value.
   * Null-hash events (pre-migration) are skipped.
   * Fail-open: verification errors return invalid with details, never throw.
   */
  verifyChain(fromId?: string, toId?: string): ChainVerifyResult {
    try {
      let sql = `SELECT id, event_type, payload, timestamp, prev_hash, hash FROM events`;
      const conditions: string[] = [];
      const params: unknown[] = [];

      if (fromId) {
        conditions.push(`rowid >= (SELECT rowid FROM events WHERE id = ?)`);
        params.push(fromId);
      }
      if (toId) {
        conditions.push(`rowid <= (SELECT rowid FROM events WHERE id = ?)`);
        params.push(toId);
      }

      if (conditions.length > 0) sql += ` WHERE ${conditions.join(" AND ")}`;
      sql += ` ORDER BY rowid ASC`;

      const rows = this.db.prepare(sql).all(...params) as Array<{
        id: string; event_type: string; payload: string;
        timestamp: number; prev_hash: string | null; hash: string | null;
      }>;

      let checked = 0;
      let skipped = 0;

      for (const row of rows) {
        // Skip pre-migration events (null hash)
        if (!row.hash || !row.prev_hash) {
          skipped++;
          continue;
        }

        const expected = computeEventHash(row.prev_hash, row.event_type, row.payload, row.timestamp);
        if (expected !== row.hash) {
          return { valid: false, checked, skipped, brokenAt: row.id, expected, actual: row.hash };
        }
        checked++;
      }

      return { valid: true, checked, skipped };
    } catch {
      return { valid: true, checked: 0, skipped: 0 }; // Fail-open
    }
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
      let prevHash = this.getLastHash();
      for (const event of events) {
        const id = randomUUID();
        const payload = JSON.stringify(event.payload);
        const hash = computeEventHash(prevHash, event.type, payload, event.timestamp);
        this.stmtAppend.run(...this._eventParams(id, event), prevHash, hash);
        ids.push(id);
        prevHash = hash;
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
    try { return JSON.parse(row.value); } catch (err) { console.warn(`[store] getKV JSON parse failed for key '${key}': ${(err as Error).message}`); return null; }
  }

  /** Write a KV entry. */
  setKV(key: string, value: unknown): void {
    this.stmtSetKV.run(key, JSON.stringify(value), Date.now());
  }

  // ── Fact Store (v0.6.4 FACT track) ───────────

  /** Add a fact candidate. Deduplicates by content similarity (exact match). */
  addFact(fact: { scope?: string; category: string; content: string; projectId?: string }): string {
    const now = Date.now();
    // Check for exact duplicate
    const existing = this.db.prepare(
      "SELECT id, frequency FROM facts WHERE content = ? AND project_id IS ?",
    ).get(fact.content, fact.projectId ?? null) as { id: string; frequency: number } | undefined;

    if (existing) {
      this.db.prepare(
        "UPDATE facts SET frequency = frequency + 1, updated_at = ? WHERE id = ?",
      ).run(now, existing.id);
      return existing.id;
    }

    const id = randomUUID();
    this.db.prepare(
      "INSERT INTO facts (id, scope, category, content, frequency, status, project_id, created_at, updated_at) VALUES (?, ?, ?, ?, 1, 'candidate', ?, ?, ?)",
    ).run(id, fact.scope ?? "project", fact.category, fact.content, fact.projectId ?? null, now, now);
    return id;
  }

  /** Query facts with filters. */
  getFacts(filter: { scope?: string; status?: string; category?: string; projectId?: string; limit?: number } = {}): Array<{
    id: string; scope: string; category: string; content: string;
    frequency: number; status: string; projectId: string | null;
    createdAt: number; updatedAt: number;
  }> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (filter.scope) { conditions.push("scope = ?"); params.push(filter.scope); }
    if (filter.status) { conditions.push("status = ?"); params.push(filter.status); }
    if (filter.category) { conditions.push("category = ?"); params.push(filter.category); }
    if (filter.projectId) { conditions.push("project_id = ?"); params.push(filter.projectId); }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = filter.limit ? `LIMIT ${Number(filter.limit)}` : "";
    const sql = `SELECT * FROM facts ${where} ORDER BY frequency DESC, updated_at DESC ${limit}`;
    const rows = this.db.prepare(sql).all(...params) as Array<Record<string, unknown>>;
    return rows.map(r => ({
      id: r.id as string,
      scope: r.scope as string,
      category: r.category as string,
      content: r.content as string,
      frequency: r.frequency as number,
      status: r.status as string,
      projectId: r.project_id as string | null,
      createdAt: r.created_at as number,
      updatedAt: r.updated_at as number,
    }));
  }

  /** Promote a fact to a new status. */
  promoteFact(id: string, newStatus: "candidate" | "established" | "archived"): void {
    this.db.prepare("UPDATE facts SET status = ?, updated_at = ? WHERE id = ?").run(newStatus, Date.now(), id);
  }

  /** Archive stale candidate facts older than N ms. Returns count archived. */
  archiveStaleFacts(olderThanMs: number): number {
    const cutoff = Date.now() - olderThanMs;
    const result = this.db.prepare(
      "UPDATE facts SET status = 'archived', updated_at = ? WHERE status = 'candidate' AND updated_at < ?",
    ).run(Date.now(), cutoff);
    return (result as { changes: number }).changes ?? 0;
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
        try { rmSync(tmp, { force: true }); } catch (err) { console.warn(`[store] failed to clean temp file ${tmp}: ${(err as Error).message}`); }
      }
      throw err;
    }

    // Phase 3: rename temp → target
    for (const { tmp, target } of tempPaths) {
      try {
        renameSync(tmp, target);
      } catch (err) {
        // Non-fatal: SQLite is truth, projection will regenerate
        console.warn(`[store] rename ${tmp} → ${target} failed: ${(err as Error).message}`);
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
