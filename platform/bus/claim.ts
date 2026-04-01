/**
 * Claim Service — per-file ownership for worktree conflict prevention.
 *
 * Agents claim files before modifying them. Other agents check for conflicts
 * before starting work. Claims expire via TTL (default 10 minutes).
 *
 * SQL INSERT...ON CONFLICT pattern: no TOCTOU races, same as LockService.
 * All claims are stored in the `file_claims` table (created by EventStore).
 */

import type { SQLiteDatabase, SQLiteStatement } from "./sqlite-adapter.js";

export interface ClaimInfo {
  filePath: string;
  agentId: string;
  sessionId?: string;
  claimedAt: number;
  ttlMs: number;
}

export interface ClaimConflict {
  filePath: string;
  heldBy: string;
  sessionId?: string;
  claimedAt: number;
}

export class ClaimService {
  private db: SQLiteDatabase;

  // ── Cached prepared statements ──
  private stmtCleanExpired: SQLiteStatement;
  private stmtUpsert: SQLiteStatement;
  private stmtVerifyOwner: SQLiteStatement;
  private stmtReleaseByAgent: SQLiteStatement;
  private stmtReleasePath: SQLiteStatement;
  private stmtCheckHeld: SQLiteStatement;
  private stmtListByAgent: SQLiteStatement;
  private stmtListActive: SQLiteStatement;
  private stmtCleanAll: SQLiteStatement;

  constructor(db: SQLiteDatabase) {
    this.db = db;

    this.stmtCleanExpired = db.prepare(
      `DELETE FROM file_claims WHERE file_path = ? AND claimed_at + ttl_ms < ?`
    );
    // Claim succeeds if: no existing claim, OR existing claim is by same agent, OR existing claim is expired
    this.stmtUpsert = db.prepare(`
      INSERT INTO file_claims (file_path, agent_id, session_id, claimed_at, ttl_ms)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(file_path) DO UPDATE SET
        agent_id = excluded.agent_id,
        session_id = excluded.session_id,
        claimed_at = excluded.claimed_at,
        ttl_ms = excluded.ttl_ms
      WHERE file_claims.agent_id = ? OR file_claims.claimed_at + file_claims.ttl_ms < ?
    `);
    this.stmtVerifyOwner = db.prepare(
      `SELECT agent_id FROM file_claims WHERE file_path = ?`
    );
    this.stmtReleaseByAgent = db.prepare(
      `DELETE FROM file_claims WHERE agent_id = ?`
    );
    this.stmtReleasePath = db.prepare(
      `DELETE FROM file_claims WHERE file_path = ?`
    );
    this.stmtCheckHeld = db.prepare(
      `SELECT * FROM file_claims WHERE file_path = ? AND claimed_at + ttl_ms > ?`
    );
    this.stmtListByAgent = db.prepare(
      `SELECT * FROM file_claims WHERE agent_id = ? AND claimed_at + ttl_ms > ?`
    );
    this.stmtListActive = db.prepare(
      `SELECT * FROM file_claims WHERE claimed_at + ttl_ms > ?`
    );
    this.stmtCleanAll = db.prepare(
      `DELETE FROM file_claims WHERE claimed_at + ttl_ms < ?`
    );
  }

  /**
   * Atomically claim multiple files for an agent.
   * Returns list of files that could NOT be claimed (held by other agents).
   * All-or-nothing: if any file conflicts, no files are claimed.
   */
  claimFiles(
    agentId: string,
    files: string[],
    sessionId?: string,
    ttlMs = 600_000,
  ): ClaimConflict[] {
    const now = Date.now();

    // Phase 1: check for conflicts (reuse checkConflicts)
    const conflicts = this.checkConflicts(agentId, files);
    if (conflicts.length > 0) return conflicts;

    // Phase 2: atomic claim via transaction
    const claimAll = this.db.transaction(() => {
      for (const filePath of files) {
        this.stmtCleanExpired.run(filePath, now);
        this.stmtUpsert.run(filePath, agentId, sessionId ?? null, now, ttlMs, agentId, now);

        // Verify ownership
        const row = this.stmtVerifyOwner.get(filePath) as { agent_id: string } | undefined;
        if (row?.agent_id !== agentId) {
          throw new Error(`Claim race on ${filePath}: held by ${row?.agent_id}`);
        }
      }
    });

    try {
      claimAll();
    } catch (err) {
      // Race condition: another agent claimed between check and claim
      // Re-check to return accurate conflicts
      console.warn(`[claim] race condition during claimFiles: ${(err as Error).message}`);
      return this.checkConflicts(agentId, files);
    }

    return []; // No conflicts — all claimed successfully
  }

  /**
   * Release all files claimed by an agent. Called when agent completes or crashes.
   */
  releaseFiles(agentId: string): number {
    const result = this.stmtReleaseByAgent.run(agentId);
    return result.changes;
  }

  /**
   * Release a specific file path (regardless of owner).
   */
  releasePath(filePath: string): boolean {
    const result = this.stmtReleasePath.run(filePath);
    return result.changes > 0;
  }

  /**
   * Check which files would conflict if an agent tried to claim them.
   * Does NOT acquire any claims — read-only query.
   */
  checkConflicts(agentId: string, files: string[]): ClaimConflict[] {
    const now = Date.now();
    const conflicts: ClaimConflict[] = [];

    for (const filePath of files) {
      const row = this.stmtCheckHeld.get(filePath, now) as ClaimRow | undefined;
      if (row && row.agent_id !== agentId) {
        conflicts.push({
          filePath: row.file_path,
          heldBy: row.agent_id,
          sessionId: row.session_id ?? undefined,
          claimedAt: row.claimed_at,
        });
      }
    }

    return conflicts;
  }

  /**
   * Get all active claims, optionally filtered by agent.
   */
  getClaims(agentId?: string): ClaimInfo[] {
    const now = Date.now();
    const rows = agentId
      ? this.stmtListByAgent.all(agentId, now) as ClaimRow[]
      : this.stmtListActive.all(now) as ClaimRow[];

    return rows.map(toClaimInfo);
  }

  /**
   * Remove all expired claims. Returns count of cleaned claims.
   */
  cleanExpired(): number {
    const result = this.stmtCleanAll.run(Date.now());
    return result.changes;
  }
}

// ── Internal types ──

interface ClaimRow {
  file_path: string;
  agent_id: string;
  session_id: string | null;
  claimed_at: number;
  ttl_ms: number;
}

function toClaimInfo(row: ClaimRow): ClaimInfo {
  return {
    filePath: row.file_path,
    agentId: row.agent_id,
    sessionId: row.session_id ?? undefined,
    claimedAt: row.claimed_at,
    ttlMs: row.ttl_ms,
  };
}
