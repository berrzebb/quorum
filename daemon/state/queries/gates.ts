/**
 * Gate status queries — 3 enforcement gates derived from SQLite state.
 */

import type { SQLiteDatabase, SQLiteStatement } from "../../../platform/bus/sqlite-adapter.js";
import type { EventStore } from "../../../platform/bus/store.js";

// ── Types ────────────────────────────────────

export interface GateInfo {
  name: string;
  status: "open" | "blocked" | "pending" | "error";
  detail?: string;
  since?: number;
}

// ── Query ────────────────────────────────────

export function queryGateStatus(store: EventStore): GateInfo[] {
  const gates: GateInfo[] = [];
  const db = store.getDb();

  // Audit gate: latest gate transition
  const auditState = latestTransition(db, "gate", "audit");
  gates.push({
    name: "Audit",
    status: auditState
      ? (auditState.to_state === "approved" ? "open"
        : auditState.to_state === "pending" ? "pending"
        : auditState.to_state === "infra_failure" ? "error"
        : "blocked")
      : "open",
    detail: auditState?.to_state,
    since: auditState?.created_at,
  });

  // Retro gate: from kv_state
  const retroMarker = store.getKV("retro:marker") as { retro_pending?: boolean; completed_at?: string } | null;
  gates.push({
    name: "Retro",
    status: retroMarker?.retro_pending ? "blocked" : "open",
    detail: retroMarker?.retro_pending ? "retrospective pending" : undefined,
  });

  // Dream consolidation: from kv_state (independent of retro gate)
  const dreamState = store.getKV("dream:state") as {
    consolidationStatus?: string;
    lastConsolidatedAt?: number;
    lastDigestId?: string;
  } | null;
  if (dreamState) {
    const cs = dreamState.consolidationStatus ?? "idle";
    gates.push({
      name: "Dream",
      status: cs === "running" ? "pending"
        : cs === "failed" ? "error"
        : cs === "ready" ? "open"
        : "open",
      detail: cs !== "idle"
        ? `consolidation ${cs}${dreamState.lastConsolidatedAt ? ` (last: ${new Date(dreamState.lastConsolidatedAt).toISOString().slice(0, 16)})` : ""}`
        : dreamState.lastConsolidatedAt
          ? `last consolidated ${new Date(dreamState.lastConsolidatedAt).toISOString().slice(0, 16)}`
          : undefined,
    });
  }

  // Quality gate: recent quality.fail events in last 5 minutes
  const fiveMinAgo = Date.now() - 300_000;
  const qualityFails = store.count({
    eventType: "quality.fail",
    since: fiveMinAgo,
  });
  gates.push({
    name: "Quality",
    status: qualityFails > 0 ? "blocked" : "open",
    detail: qualityFails > 0 ? `${qualityFails} recent failure(s)` : undefined,
  });

  return gates;
}

// ── Private helpers ──────────────────────────

const transitionStmtCache = new WeakMap<SQLiteDatabase, SQLiteStatement>();

function latestTransition(db: SQLiteDatabase, entityType: string, entityId: string): {
  to_state: string;
  created_at: number;
} | null {
  try {
    let stmt = transitionStmtCache.get(db);
    if (!stmt) {
      stmt = db.prepare(`
        SELECT to_state, created_at FROM state_transitions
        WHERE entity_type = ? AND entity_id = ?
        ORDER BY created_at DESC, rowid DESC
        LIMIT 1
      `);
      transitionStmtCache.set(db, stmt);
    }
    return stmt.get(entityType, entityId) as { to_state: string; created_at: number } | undefined ?? null;
  } catch (err) {
    console.warn(`[gates] latestTransition query failed: ${(err as Error).message}`);
    return null;
  }
}
