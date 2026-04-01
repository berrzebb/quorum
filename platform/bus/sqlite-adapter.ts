/**
 * SQLite Adapter — runtime-detected database backend.
 *
 * Supports two backends:
 * - bun:sqlite (Bun runtime — preferred, zero-dependency)
 * - better-sqlite3 (Node.js runtime — npm package)
 *
 * Both provide synchronous SQLite access with compatible APIs.
 * This adapter normalizes the minor differences.
 *
 * Detection: tries bun:sqlite first (only available in Bun),
 * falls back to better-sqlite3.
 *
 * @module bus/sqlite-adapter
 */

// ── Types (compatible subset of both APIs) ─────────────

export interface SQLiteDatabase {
  exec(sql: string): unknown;
  prepare(sql: string): SQLiteStatement;
  pragma(pragma: string): unknown;
  transaction<T>(fn: (...args: any[]) => T): (...args: any[]) => T;
  close(): void;
  /** Backend identifier for diagnostics. */
  readonly _backend: "bun:sqlite" | "better-sqlite3";
}

export interface SQLiteStatement {
  run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
  get(...params: unknown[]): any;
  all(...params: unknown[]): any[];
}

// ── Backend detection ──────────────────────────────────

let _backend: "bun:sqlite" | "better-sqlite3" | null = null;
let _BunDatabase: any = null;
let _BetterSqlite3: any = null;

// Try bun:sqlite first (only works in Bun runtime)
try {
  // Dynamic require to avoid parse-time errors in Node.js
  _BunDatabase = (await import("bun:sqlite" as any)).Database;
  _backend = "bun:sqlite";
} catch {
  // Not in Bun — try better-sqlite3
  try {
    _BetterSqlite3 = (await import("better-sqlite3")).default;
    _backend = "better-sqlite3";
  } catch {
    // Neither available — will throw on openDatabase()
  }
}

// ── Factory ────────────────────────────────────────────

/**
 * Open a SQLite database with the best available backend.
 *
 * @param dbPath — path to database file (or ":memory:")
 * @returns SQLiteDatabase wrapper
 * @throws if no SQLite backend is available
 */
export function openDatabase(dbPath: string): SQLiteDatabase {
  if (_backend === "bun:sqlite" && _BunDatabase) {
    const db = new _BunDatabase(dbPath);
    // Wrap to normalize API
    return {
      exec: (sql: string) => db.exec(sql),
      prepare: (sql: string) => wrapBunStatement(db.prepare(sql)),
      pragma: (p: string) => db.exec(`PRAGMA ${p}`),
      transaction: <T>(fn: (...args: any[]) => T) => db.transaction(fn),
      close: () => db.close(),
      _backend: "bun:sqlite",
    };
  }

  if (_backend === "better-sqlite3" && _BetterSqlite3) {
    const db = new _BetterSqlite3(dbPath);
    return {
      exec: (sql: string) => db.exec(sql),
      prepare: (sql: string) => db.prepare(sql),
      pragma: (p: string) => db.pragma(p),
      transaction: <T>(fn: (...args: any[]) => T) => db.transaction(fn),
      close: () => db.close(),
      _backend: "better-sqlite3",
    };
  }

  throw new Error(
    "[sqlite-adapter] No SQLite backend available. Install better-sqlite3 (Node.js) or use Bun runtime."
  );
}

/**
 * Wrap bun:sqlite Statement to match better-sqlite3's .run() return shape.
 * bun:sqlite returns { changes, lastInsertRowid } from .run() — same as better-sqlite3.
 * .get() and .all() are already compatible.
 */
function wrapBunStatement(stmt: any): SQLiteStatement {
  return {
    run: (...params: unknown[]) => stmt.run(...params),
    get: (...params: unknown[]) => stmt.get(...params),
    all: (...params: unknown[]) => stmt.all(...params),
  };
}

/**
 * Get the active SQLite backend name.
 * @returns "bun:sqlite" | "better-sqlite3" | null
 */
export function getBackend(): string | null {
  return _backend;
}

/**
 * Check if any SQLite backend is available.
 */
export function isSQLiteAvailable(): boolean {
  return _backend !== null;
}
