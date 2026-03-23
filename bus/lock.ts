/**
 * Lock Service — atomic lock acquisition via SQLite.
 *
 * Replaces JSON lock files (audit.lock) with database-backed locks.
 * Single SQL statement per operation = no TOCTOU race conditions.
 *
 * Locks have a TTL (default 30 minutes). Expired locks are automatically
 * ignored by acquire() and can be cleaned up by cleanExpired().
 */

import type Database from "better-sqlite3";

export interface LockInfo {
  held: boolean;
  lockName?: string;
  owner?: number;
  ownerSession?: string;
  acquiredAt?: number;
  ttlMs?: number;
}

export class LockService {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  /**
   * Acquire a named lock atomically.
   *
   * Uses a single INSERT that checks for unexpired locks held by a different PID.
   * Returns true if the lock was acquired, false if held by another process.
   *
   * If the same PID re-acquires, the lock is refreshed (idempotent).
   */
  acquire(
    lockName: string,
    pid: number,
    sessionId?: string,
    ttlMs = 1_800_000,
  ): boolean {
    const now = Date.now();

    // First, try to delete any expired lock for this name
    this.db.prepare(
      `DELETE FROM locks WHERE lock_name = ? AND acquired_at + ttl_ms < ?`
    ).run(lockName, now);

    // Attempt insert; if lock exists for different PID, this fails gracefully
    try {
      this.db.prepare(`
        INSERT INTO locks (lock_name, owner_pid, owner_session, acquired_at, ttl_ms)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(lock_name) DO UPDATE SET
          owner_pid = excluded.owner_pid,
          owner_session = excluded.owner_session,
          acquired_at = excluded.acquired_at,
          ttl_ms = excluded.ttl_ms
        WHERE locks.owner_pid = ? OR locks.acquired_at + locks.ttl_ms < ?
      `).run(lockName, pid, sessionId ?? null, now, ttlMs, pid, now);

      // Verify we actually own the lock
      const row = this.db.prepare(
        `SELECT owner_pid FROM locks WHERE lock_name = ?`
      ).get(lockName) as { owner_pid: number } | undefined;

      return row?.owner_pid === pid;
    } catch {
      return false;
    }
  }

  /**
   * Release a named lock. Only the owner (matching PID) can release.
   */
  release(lockName: string, pid: number): boolean {
    const result = this.db.prepare(
      `DELETE FROM locks WHERE lock_name = ? AND owner_pid = ?`
    ).run(lockName, pid);
    return result.changes > 0;
  }

  /**
   * Force-release expired locks. Called periodically by daemon.
   * Returns the number of locks cleaned up.
   */
  cleanExpired(): number {
    const now = Date.now();
    const result = this.db.prepare(
      `DELETE FROM locks WHERE acquired_at + ttl_ms < ?`
    ).run(now);
    return result.changes;
  }

  /**
   * Check if a lock is currently held (not expired).
   */
  isHeld(lockName: string): LockInfo {
    const now = Date.now();
    const row = this.db.prepare(
      `SELECT * FROM locks WHERE lock_name = ? AND acquired_at + ttl_ms > ?`
    ).get(lockName, now) as {
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

  /**
   * List all active (non-expired) locks.
   */
  listActive(): LockInfo[] {
    const now = Date.now();
    const rows = this.db.prepare(
      `SELECT * FROM locks WHERE acquired_at + ttl_ms > ?`
    ).all(now) as Array<{
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
