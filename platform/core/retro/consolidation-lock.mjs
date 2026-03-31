/**
 * Consolidation Lock — single-writer coordination for Dream consolidation.
 *
 * Inspired by Claude Code's `consolidationLock.ts`:
 * - Lock file with `mtime = lastConsolidatedAt` semantic
 * - PID guard for live holder detection
 * - Stale timeout for dead holder reclaim
 * - Rollback on abort/failure
 *
 * Core invariant: only one consolidation writer at a time.
 * Dead locks are reclaimable; live locks are respected.
 *
 * @module core/retro/consolidation-lock
 * @since RDI-2
 */

import { existsSync, readFileSync, writeFileSync, unlinkSync, statSync, utimesSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { mkdirSync } from "node:fs";

// ── Types (JSDoc) ────────────────────────────

/**
 * @typedef {Object} LockHandle
 * @property {string} path - lock file path
 * @property {number} holderPid - PID that holds the lock
 * @property {number} acquiredAt - epoch ms when lock was acquired
 * @property {number} priorMtime - mtime before acquisition (for rollback)
 */

/**
 * @typedef {Object} LockResult
 * @property {boolean} acquired - whether lock was obtained
 * @property {LockHandle|null} handle - lock handle if acquired
 * @property {string} reason - human-readable result
 */

/**
 * @typedef {Object} LockFileContent
 * @property {number} pid - holder PID
 * @property {number} acquiredAt - epoch ms
 * @property {number} lastConsolidatedAt - epoch ms (encoded in mtime and content)
 */

// ── Constants ────────────────────────────────

/** Default stale timeout: 10 minutes. */
export const DEFAULT_STALE_TIMEOUT_MS = 10 * 60 * 1000;

/** Default lock file name. */
export const LOCK_FILE_NAME = "consolidation.lock";

// ── Lock Operations ──────────────────────────

/**
 * Attempt to acquire the consolidation lock.
 *
 * Returns a handle on success, or a reason on failure.
 * Does NOT reclaim stale locks automatically — caller must explicitly reclaim.
 *
 * @param {string} lockDir - directory to place lock file
 * @param {object} [options]
 * @param {number} [options.staleTimeoutMs] - timeout for stale detection
 * @param {number} [options.pid] - override PID (for testing)
 * @returns {LockResult}
 */
export function tryAcquire(lockDir, options) {
  const staleTimeoutMs = options?.staleTimeoutMs ?? DEFAULT_STALE_TIMEOUT_MS;
  const myPid = options?.pid ?? process.pid;
  const lockPath = resolve(lockDir, LOCK_FILE_NAME);

  mkdirSync(lockDir, { recursive: true });

  // Check existing lock
  if (existsSync(lockPath)) {
    const existing = readLock(lockPath);
    if (existing) {
      // Check if holder is still alive
      if (isProcessAlive(existing.pid)) {
        return {
          acquired: false,
          handle: null,
          reason: `lock held by live process ${existing.pid} (since ${new Date(existing.acquiredAt).toISOString()})`,
        };
      }

      // Holder is dead — check if stale
      const age = Date.now() - existing.acquiredAt;
      if (age < staleTimeoutMs) {
        return {
          acquired: false,
          handle: null,
          reason: `lock held by dead process ${existing.pid}, not yet stale (${Math.round(age / 1000)}s < ${Math.round(staleTimeoutMs / 1000)}s)`,
        };
      }

      // Stale lock — caller should reclaimStale() first
      return {
        acquired: false,
        handle: null,
        reason: `stale lock from dead process ${existing.pid} (age: ${Math.round(age / 1000)}s) — call reclaimStale() first`,
      };
    }
  }

  // Acquire: write lock file
  const priorMtime = getLockMtime(lockPath);
  const now = Date.now();

  /** @type {LockFileContent} */
  const content = {
    pid: myPid,
    acquiredAt: now,
    lastConsolidatedAt: priorMtime,
  };

  writeLock(lockPath, content);

  return {
    acquired: true,
    handle: {
      path: lockPath,
      holderPid: myPid,
      acquiredAt: now,
      priorMtime,
    },
    reason: "lock acquired",
  };
}

/**
 * Release the consolidation lock after successful consolidation.
 *
 * Updates mtime to mark last consolidation time, then removes lock.
 *
 * @param {LockHandle} handle
 * @param {number} [consolidatedAt] - override consolidation timestamp
 * @returns {{ released: boolean; lastConsolidatedAt: number }}
 */
export function release(handle, consolidatedAt) {
  const ts = consolidatedAt ?? Date.now();

  try {
    if (existsSync(handle.path)) {
      // Update mtime to record consolidation time before removing
      const date = new Date(ts);
      utimesSync(handle.path, date, date);
      unlinkSync(handle.path);
    }
  } catch (err) {
    // Best effort — lock file may already be gone
    console.warn(`[consolidation-lock] release warning: ${err?.message ?? err}`);
  }

  return { released: true, lastConsolidatedAt: ts };
}

/**
 * Rollback the lock after consolidation failure.
 *
 * Restores prior mtime (so next trigger evaluation sees the old timestamp)
 * and removes the lock file.
 *
 * @param {LockHandle} handle
 * @returns {{ rolledBack: boolean; restoredMtime: number }}
 */
export function rollback(handle) {
  try {
    if (existsSync(handle.path)) {
      // Restore prior mtime if it was meaningful
      if (handle.priorMtime > 0) {
        const date = new Date(handle.priorMtime);
        utimesSync(handle.path, date, date);
      }
      unlinkSync(handle.path);
    }
  } catch (err) {
    console.warn(`[consolidation-lock] rollback warning: ${err?.message ?? err}`);
  }

  return { rolledBack: true, restoredMtime: handle.priorMtime };
}

/**
 * Reclaim a stale lock from a dead holder.
 *
 * Checks that the holder PID is dead and the lock is past stale timeout.
 * If both conditions hold, removes the lock so tryAcquire() can proceed.
 *
 * @param {string} lockDir
 * @param {object} [options]
 * @param {number} [options.staleTimeoutMs]
 * @returns {{ reclaimed: boolean; reason: string; priorContent?: LockFileContent }}
 */
export function reclaimStale(lockDir, options) {
  const staleTimeoutMs = options?.staleTimeoutMs ?? DEFAULT_STALE_TIMEOUT_MS;
  const lockPath = resolve(lockDir, LOCK_FILE_NAME);

  if (!existsSync(lockPath)) {
    return { reclaimed: false, reason: "no lock file" };
  }

  const existing = readLock(lockPath);
  if (!existing) {
    // Corrupt lock file — safe to remove
    unlinkSync(lockPath);
    return { reclaimed: true, reason: "corrupt lock removed" };
  }

  // Don't reclaim from live processes
  if (isProcessAlive(existing.pid)) {
    return { reclaimed: false, reason: `holder PID ${existing.pid} is alive` };
  }

  // Check staleness
  const age = Date.now() - existing.acquiredAt;
  if (age < staleTimeoutMs) {
    return {
      reclaimed: false,
      reason: `not stale yet (${Math.round(age / 1000)}s < ${Math.round(staleTimeoutMs / 1000)}s)`,
    };
  }

  // Safe to reclaim
  try {
    unlinkSync(lockPath);
  } catch { /* already gone */ }

  return { reclaimed: true, reason: `reclaimed from dead PID ${existing.pid}`, priorContent: existing };
}

/**
 * Check whether a consolidation lock currently exists and is held.
 *
 * @param {string} lockDir
 * @returns {{ locked: boolean; holder?: number; acquiredAt?: number; alive?: boolean }}
 */
export function checkLock(lockDir) {
  const lockPath = resolve(lockDir, LOCK_FILE_NAME);

  if (!existsSync(lockPath)) {
    return { locked: false };
  }

  const existing = readLock(lockPath);
  if (!existing) {
    return { locked: false };
  }

  return {
    locked: true,
    holder: existing.pid,
    acquiredAt: existing.acquiredAt,
    alive: isProcessAlive(existing.pid),
  };
}

/**
 * Read last consolidation time from the lock file mtime or content.
 *
 * When no lock file exists, returns 0 (never consolidated).
 * When lock file exists, returns the lastConsolidatedAt from content
 * or the file mtime as fallback.
 *
 * @param {string} lockDir
 * @returns {number} epoch ms
 */
export function getLastConsolidatedAt(lockDir) {
  // Sentinel file is the primary source (survives lock removal)
  const sentinelPath = resolve(lockDir, "consolidation-timestamp");
  try {
    const ts = parseInt(readFileSync(sentinelPath, "utf8").trim(), 10);
    if (!isNaN(ts) && ts > 0) return ts;
  } catch { /* sentinel missing or unreadable — try lock file */ }

  // Fallback: read from lock file content
  const content = readLock(resolve(lockDir, LOCK_FILE_NAME));
  if (content?.lastConsolidatedAt) return content.lastConsolidatedAt;

  return 0;
}

/**
 * Persist the last consolidation timestamp to a sentinel file.
 * This survives lock file removal and provides stable mtime tracking.
 *
 * @param {string} lockDir
 * @param {number} timestamp - epoch ms
 */
export function persistConsolidationTimestamp(lockDir, timestamp) {
  const sentinelPath = resolve(lockDir, "consolidation-timestamp");
  mkdirSync(lockDir, { recursive: true });
  writeFileSync(sentinelPath, String(timestamp), "utf8");
}

// ── Helpers (private) ────────────────────────

/**
 * @param {string} lockPath
 * @returns {LockFileContent|null}
 */
function readLock(lockPath) {
  try {
    const raw = readFileSync(lockPath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * @param {string} lockPath
 * @param {LockFileContent} content
 */
function writeLock(lockPath, content) {
  mkdirSync(dirname(lockPath), { recursive: true });
  writeFileSync(lockPath, JSON.stringify(content, null, 2), "utf8");
}

/**
 * Get mtime of a file as epoch ms. Returns 0 if file doesn't exist.
 * @param {string} filePath
 * @returns {number}
 */
function getLockMtime(filePath) {
  try {
    if (!existsSync(filePath)) return 0;
    return statSync(filePath).mtimeMs;
  } catch {
    return 0;
  }
}

/**
 * Check if a process is alive.
 * Sends signal 0 — doesn't terminate, just checks existence.
 *
 * @param {number} pid
 * @returns {boolean}
 */
function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
