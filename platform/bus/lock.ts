/**
 * Lock Service — atomic lock acquisition via SQLite.
 *
 * Replaces JSON lock files (audit.lock) with database-backed locks.
 * Single SQL statement per operation = no TOCTOU race conditions.
 *
 * Locks have a TTL (default 30 minutes). Expired locks are automatically
 * ignored by acquire() and can be cleaned up by cleanExpired().
 */

import type { SQLiteDatabase, SQLiteStatement } from "./sqlite-adapter.js";

export interface LockInfo {
  held: boolean;
  lockName?: string;
  owner?: number;
  ownerSession?: string;
  acquiredAt?: number;
  ttlMs?: number;
}

export class LockService {
  private db: SQLiteDatabase;

  // ── Cached prepared statements ──
  private stmtDeleteExpired: SQLiteStatement;
  private stmtUpsert: SQLiteStatement;
  private stmtVerifyOwner: SQLiteStatement;
  private stmtRelease: SQLiteStatement;
  private stmtCleanAll: SQLiteStatement;
  private stmtIsHeld: SQLiteStatement;
  private stmtListActive: SQLiteStatement;

  constructor(db: SQLiteDatabase) {
    this.db = db;

    this.stmtDeleteExpired = db.prepare(
      `DELETE FROM locks WHERE lock_name = ? AND acquired_at + ttl_ms < ?`
    );
    this.stmtUpsert = db.prepare(`
      INSERT INTO locks (lock_name, owner_pid, owner_session, acquired_at, ttl_ms)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(lock_name) DO UPDATE SET
        owner_pid = excluded.owner_pid,
        owner_session = excluded.owner_session,
        acquired_at = excluded.acquired_at,
        ttl_ms = excluded.ttl_ms
      WHERE locks.owner_pid = ? OR locks.acquired_at + locks.ttl_ms < ?
    `);
    this.stmtVerifyOwner = db.prepare(
      `SELECT owner_pid FROM locks WHERE lock_name = ?`
    );
    this.stmtRelease = db.prepare(
      `DELETE FROM locks WHERE lock_name = ? AND owner_pid = ?`
    );
    this.stmtCleanAll = db.prepare(
      `DELETE FROM locks WHERE acquired_at + ttl_ms < ?`
    );
    this.stmtIsHeld = db.prepare(
      `SELECT * FROM locks WHERE lock_name = ? AND acquired_at + ttl_ms > ?`
    );
    this.stmtListActive = db.prepare(
      `SELECT * FROM locks WHERE acquired_at + ttl_ms > ?`
    );
  }

  acquire(
    lockName: string,
    pid: number,
    sessionId?: string,
    ttlMs = 1_800_000,
  ): boolean {
    const now = Date.now();
    this.stmtDeleteExpired.run(lockName, now);

    try {
      this.stmtUpsert.run(lockName, pid, sessionId ?? null, now, ttlMs, pid, now);
      const row = this.stmtVerifyOwner.get(lockName) as { owner_pid: number } | undefined;
      return row?.owner_pid === pid;
    } catch (err) {
      console.warn(`[lock] acquire failed for '${lockName}': ${(err as Error).message}`);
      return false;
    }
  }

  release(lockName: string, pid: number): boolean {
    const result = this.stmtRelease.run(lockName, pid);
    return result.changes > 0;
  }

  cleanExpired(): number {
    const result = this.stmtCleanAll.run(Date.now());
    return result.changes;
  }

  isHeld(lockName: string): LockInfo {
    const now = Date.now();
    const row = this.stmtIsHeld.get(lockName, now) as {
      lock_name: string;
      owner_pid: number;
      owner_session: string | null;
      acquired_at: number;
      ttl_ms: number;
    } | undefined;

    if (!row) return { held: false };

    return {
      held: true,
      lockName: row.lock_name,
      owner: row.owner_pid,
      ownerSession: row.owner_session ?? undefined,
      acquiredAt: row.acquired_at,
      ttlMs: row.ttl_ms,
    };
  }

  listActive(): LockInfo[] {
    const now = Date.now();
    const rows = this.stmtListActive.all(now) as Array<{
      lock_name: string;
      owner_pid: number;
      owner_session: string | null;
      acquired_at: number;
      ttl_ms: number;
    }>;

    return rows.map(row => ({
      held: true,
      lockName: row.lock_name,
      owner: row.owner_pid,
      ownerSession: row.owner_session ?? undefined,
      acquiredAt: row.acquired_at,
      ttlMs: row.ttl_ms,
    }));
  }
}
