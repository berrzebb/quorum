/**
 * Vault Store — SQLite database for session search and knowledge indexing.
 *
 * Separate from EventStore (quorum-events.db). This DB stores:
 * - Parsed sessions/turns/actions (from raw JSONL)
 * - FTS5 index for keyword search (BM25)
 * - Embedding vectors for semantic search (BGE-M3)
 *
 * Located at vault/.store/vault.db
 */

import { mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import type { Session, Turn, Action } from "./session-model.js";

// ── Types ───────────────────────────────────────

type DB = import("../bus/sqlite-adapter.js").SQLiteDatabase;

export interface VaultStore {
  db: DB;
  /** Insert a parsed session (idempotent — skips if session.id exists). */
  insertSession(session: Session): { turns: number; actions: number };
  /** Check if a session is already ingested. */
  hasSession(sessionId: string): boolean;
  /** Get all session IDs. */
  listSessions(): Array<{ id: string; provider: string; startedAt: number; turnCount: number }>;
  /** Get turns for a session. */
  getTurns(sessionId: string, limit?: number): Array<Turn & { sessionProvider?: string }>;
  /** Search turns via FTS5 (BM25). */
  searchFTS(query: string, limit?: number): SearchResult[];
  /** Get turn IDs without embeddings (for batch embedding). */
  getUnembeddedTurnIds(limit?: number): string[];
  /** Store embedding for a turn. */
  setEmbedding(turnId: string, vector: Float32Array): void;
  /** Get embedding for a turn. */
  getEmbedding(turnId: string): Float32Array | null;
  /** Get all embeddings (for HNSW index build). */
  getAllEmbeddings(): Array<{ turnId: string; vector: Float32Array }>;
  /** Close the database. */
  close(): void;
}

export interface SearchResult {
  turnId: string;
  sessionId: string;
  provider: string;
  role: string;
  content: string;
  score: number;
  timestamp: number;
}

// ── Schema ──────────────────────────────────────

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS sessions (
    id          TEXT PRIMARY KEY,
    provider    TEXT NOT NULL,
    started_at  INTEGER NOT NULL,
    ended_at    INTEGER,
    cwd         TEXT,
    metadata    TEXT NOT NULL DEFAULT '{}',
    raw_path    TEXT
  );

  CREATE TABLE IF NOT EXISTS turns (
    id          TEXT PRIMARY KEY,
    session_id  TEXT NOT NULL REFERENCES sessions(id),
    sequence    INTEGER NOT NULL,
    role        TEXT NOT NULL,
    content     TEXT NOT NULL DEFAULT '',
    thinking    TEXT,
    timestamp   INTEGER NOT NULL,
    tokens_in   INTEGER,
    tokens_out  INTEGER
  );

  CREATE INDEX IF NOT EXISTS idx_turns_session ON turns(session_id, sequence);
  CREATE INDEX IF NOT EXISTS idx_turns_timestamp ON turns(timestamp);

  CREATE TABLE IF NOT EXISTS actions (
    id          TEXT PRIMARY KEY,
    turn_id     TEXT NOT NULL REFERENCES turns(id),
    type        TEXT NOT NULL,
    tool        TEXT NOT NULL,
    input       TEXT,
    output      TEXT,
    error       INTEGER NOT NULL DEFAULT 0,
    timestamp   INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_actions_turn ON actions(turn_id);

  CREATE TABLE IF NOT EXISTS embeddings (
    turn_id     TEXT PRIMARY KEY REFERENCES turns(id),
    vector      BLOB NOT NULL
  );
`;

const FTS_SCHEMA = `
  CREATE VIRTUAL TABLE IF NOT EXISTS turns_fts USING fts5(
    content,
    content='turns',
    content_rowid='rowid',
    tokenize='unicode61'
  );

  CREATE TRIGGER IF NOT EXISTS turns_fts_ai AFTER INSERT ON turns BEGIN
    INSERT INTO turns_fts(rowid, content) VALUES (new.rowid, new.content);
  END;

  CREATE TRIGGER IF NOT EXISTS turns_fts_ad AFTER DELETE ON turns BEGIN
    INSERT INTO turns_fts(turns_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
  END;

  CREATE TRIGGER IF NOT EXISTS turns_fts_au AFTER UPDATE OF content ON turns BEGIN
    INSERT INTO turns_fts(turns_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
    INSERT INTO turns_fts(turns_fts, rowid, content) VALUES (new.rowid, new.content);
  END;
`;

// ── Factory ─────────────────────────────────────

/**
 * Open or create vault.db at the given vault root.
 */
/**
 * Open or create vault.db. Requires pre-imported openDatabase function.
 */
export function openVaultStore(vaultRoot: string, openDatabase?: (path: string) => DB): VaultStore {
  const storeDir = join(vaultRoot, ".store");
  mkdirSync(storeDir, { recursive: true });
  const dbPath = join(storeDir, "vault.db");

  if (!openDatabase) {
    throw new Error("openDatabase function must be provided");
  }
  const db = openDatabase(dbPath);

  // WAL mode for concurrent reads
  try { db.pragma("journal_mode = WAL"); } catch { /* ok */ }
  try { db.pragma("synchronous = NORMAL"); } catch { /* ok */ }

  // Create schema
  for (const stmt of SCHEMA.split(";").filter(s => s.trim())) {
    db.exec(stmt + ";");
  }

  // FTS5 (fail-open if not supported)
  try {
    db.exec(FTS_SCHEMA);
  } catch (err) {
    console.warn(`[vault-store] FTS5 setup failed (keyword search disabled): ${(err as Error).message}`);
  }

  // Prepared statements
  const stmtInsertSession = db.prepare(
    "INSERT OR IGNORE INTO sessions (id, provider, started_at, ended_at, cwd, metadata, raw_path) VALUES (?, ?, ?, ?, ?, ?, ?)"
  );
  const stmtInsertTurn = db.prepare(
    "INSERT OR IGNORE INTO turns (id, session_id, sequence, role, content, thinking, timestamp, tokens_in, tokens_out) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
  );
  const stmtInsertAction = db.prepare(
    "INSERT OR IGNORE INTO actions (id, turn_id, type, tool, input, output, error, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  );
  const stmtHasSession = db.prepare("SELECT 1 FROM sessions WHERE id = ?");
  const stmtSetEmbedding = db.prepare(
    "INSERT OR REPLACE INTO embeddings (turn_id, vector) VALUES (?, ?)"
  );
  const stmtGetEmbedding = db.prepare("SELECT vector FROM embeddings WHERE turn_id = ?");

  return {
    db,

    insertSession(session: Session): { turns: number; actions: number } {
      let turnCount = 0;
      let actionCount = 0;

      const tx = db.transaction(() => {
        stmtInsertSession.run(
          session.id, session.provider, session.startedAt, session.endedAt ?? null,
          session.cwd, JSON.stringify(session.metadata), session.metadata.rawPath ?? null,
        );

        for (const turn of session.turns) {
          stmtInsertTurn.run(
            turn.id, session.id, turn.sequence, turn.role,
            turn.content, turn.thinking ?? null, turn.timestamp,
            turn.usage?.input ?? null, turn.usage?.output ?? null,
          );
          turnCount++;

          for (const action of turn.actions) {
            stmtInsertAction.run(
              action.id, turn.id, action.type, action.tool,
              action.input ? JSON.stringify(action.input) : null,
              action.output ?? null,
              action.error ? 1 : 0,
              action.timestamp,
            );
            actionCount++;
          }
        }
      });

      tx();
      return { turns: turnCount, actions: actionCount };
    },

    hasSession(sessionId: string): boolean {
      return !!stmtHasSession.get(sessionId);
    },

    listSessions() {
      return db.prepare(`
        SELECT s.id, s.provider, s.started_at as startedAt,
               (SELECT COUNT(*) FROM turns WHERE session_id = s.id) as turnCount
        FROM sessions s ORDER BY s.started_at DESC
      `).all() as Array<{ id: string; provider: string; startedAt: number; turnCount: number }>;
    },

    getTurns(sessionId: string, limit = 100) {
      return db.prepare(`
        SELECT t.*, s.provider as sessionProvider
        FROM turns t JOIN sessions s ON t.session_id = s.id
        WHERE t.session_id = ? ORDER BY t.sequence LIMIT ?
      `).all(sessionId, limit) as Array<Turn & { sessionProvider?: string }>;
    },

    searchFTS(query: string, limit = 20): SearchResult[] {
      // Sanitize FTS5 query
      const sanitized = query.replace(/['"(){}[\]^~*:]/g, " ").trim();
      if (!sanitized) return [];

      try {
        return db.prepare(`
          SELECT t.id as turnId, t.session_id as sessionId, s.provider,
                 t.role, t.content, rank as score, t.timestamp
          FROM turns_fts f
          JOIN turns t ON t.rowid = f.rowid
          JOIN sessions s ON t.session_id = s.id
          WHERE turns_fts MATCH ?
          ORDER BY rank
          LIMIT ?
        `).all(sanitized, limit) as SearchResult[];
      } catch {
        // Fallback to LIKE
        return db.prepare(`
          SELECT t.id as turnId, t.session_id as sessionId, s.provider,
                 t.role, t.content, 0 as score, t.timestamp
          FROM turns t
          JOIN sessions s ON t.session_id = s.id
          WHERE t.content LIKE ?
          ORDER BY t.timestamp DESC
          LIMIT ?
        `).all(`%${sanitized}%`, limit) as SearchResult[];
      }
    },

    getUnembeddedTurnIds(limit = 1000): string[] {
      return db.prepare(`
        SELECT t.id FROM turns t
        LEFT JOIN embeddings e ON t.id = e.turn_id
        WHERE e.turn_id IS NULL AND length(t.content) > 20
        ORDER BY t.timestamp DESC LIMIT ?
      `).all(limit).map((r: any) => r.id);
    },

    setEmbedding(turnId: string, vector: Float32Array): void {
      stmtSetEmbedding.run(turnId, Buffer.from(vector.buffer));
    },

    getEmbedding(turnId: string): Float32Array | null {
      const row = stmtGetEmbedding.get(turnId) as { vector: Buffer } | undefined;
      if (!row) return null;
      return new Float32Array(row.vector.buffer, row.vector.byteOffset, row.vector.byteLength / 4);
    },

    getAllEmbeddings(): Array<{ turnId: string; vector: Float32Array }> {
      const rows = db.prepare("SELECT turn_id, vector FROM embeddings").all() as Array<{ turn_id: string; vector: Buffer }>;
      return rows.map(r => ({
        turnId: r.turn_id,
        vector: new Float32Array(r.vector.buffer, r.vector.byteOffset, r.vector.byteLength / 4),
      }));
    },

    close(): void {
      db.close();
    },
  };
}
