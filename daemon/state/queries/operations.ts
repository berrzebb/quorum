/**
 * Operational queries — item states, active locks.
 *
 * Prepared statements are cached per-db to avoid recompilation on every poll tick.
 */

import type Database from "better-sqlite3";
import type { EventStore } from "../../../platform/bus/store.js";
import type { LockInfo } from "../../../platform/bus/lock.js";

// ── Types ────────────────────────────────────

export interface ItemStateInfo {
  entityId: string;
  currentState: string;
  source: string;
  label?: string;
  updatedAt: number;
}

// ── Statement cache (per database instance) ──

const stmtCache = new WeakMap<Database.Database, {
  itemStates: Database.Statement;
  activeLocks: Database.Statement;
}>();

function getStatements(db: Database.Database) {
  let cached = stmtCache.get(db);
  if (!cached) {
    cached = {
      itemStates: db.prepare(`
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
      `),
      activeLocks: db.prepare(
        `SELECT * FROM locks WHERE acquired_at + ttl_ms > ?`
      ),
    };
    stmtCache.set(db, cached);
  }
  return cached;
}

// ── Queries ──────────────────────────────────

/**
 * Current state of every tracked audit item.
 */
export function queryItemStates(db: Database.Database): ItemStateInfo[] {
  try {
    const { itemStates } = getStatements(db);
    const rows = itemStates.all() as Array<{
      entity_id: string;
      to_state: string;
      source: string;
      metadata: string;
      created_at: number;
    }>;

    return rows.map(r => {
      let label: string | undefined;
      if (r.metadata) {
        try { label = JSON.parse(r.metadata).label; } catch { /* malformed row */ }
      }
      return {
        entityId: r.entity_id,
        currentState: r.to_state,
        source: r.source,
        label,
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
export function queryActiveLocks(db: Database.Database): LockInfo[] {
  try {
    const { activeLocks } = getStatements(db);
    const rows = activeLocks.all(Date.now()) as Array<{
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
