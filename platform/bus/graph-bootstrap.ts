/**
 * Graph Bootstrap — PRD→Entity auto-extraction.
 *
 * Parses PRD.md markdown tables (FR, NFR, Core Invariant)
 * and registers entities/relations into the graph tables.
 * Markdown remains as view — graph is source of truth.
 *
 * @module bus/graph-bootstrap
 */

import { readFileSync } from "node:fs";
import { addEntity, getEntity } from "./graph-schema.js";
import { addRelation } from "./graph-relations.js";
import { parseTableCells } from "../core/markdown-table-parser.mjs";
import type { EntityType } from "./graph-schema.js";
import type { RelationType } from "./graph-relations.js";

// ── Types ────────────────────────────────────

export interface BootstrapResult {
  entities: number;
  relations: number;
  skipped: number;
}

// ── Database interface ──────────────────────

interface SQLiteStatement {
  run(...params: unknown[]): { changes: number };
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

interface SQLiteDatabase {
  prepare(sql: string): SQLiteStatement;
}

// ── Table parsing ───────────────────────────

interface ParsedRow {
  cells: string[];
}

function parseMarkdownTable(lines: string[], headerPattern: RegExp): { headers: string[]; rows: ParsedRow[] } {
  let headerIdx = -1;
  let headers: string[] = [];
  const rows: ParsedRow[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith("|")) continue;

    if (headerIdx < 0 && headerPattern.test(line)) {
      headers = splitTableRow(line);
      headerIdx = i;
      continue;
    }

    // Skip separator row
    if (headerIdx >= 0 && i === headerIdx + 1 && /^\|[\s\-:|]+\|$/.test(line)) continue;

    // Stop at next heading
    if (headerIdx >= 0 && /^#+\s/.test(lines[i].trim())) break;

    // Data row
    if (headerIdx >= 0 && line.startsWith("|")) {
      rows.push({ cells: splitTableRow(line) });
    }
  }

  return { headers, rows };
}

function splitTableRow(line: string): string[] {
  return parseTableCells(line);
}

// ── Bootstrap function ──────────────────────

export function bootstrapFromPRD(
  db: SQLiteDatabase,
  prdPath: string,
): BootstrapResult {
  const content = readFileSync(prdPath, "utf8");
  const lines = content.split(/\r?\n/);

  let entities = 0;
  let relations = 0;
  let skipped = 0;

  // ── 1. Functional Requirements ────────────
  const frTable = parseMarkdownTable(lines, /\|\s*ID\s*\|.*Track.*\|.*Requirement\s*\|/i);
  for (const row of frTable.rows) {
    const id = row.cells[0]?.trim();
    const track = row.cells[1]?.trim();
    const title = row.cells[2]?.trim();
    const ac = row.cells[3]?.trim();
    const priority = row.cells[4]?.trim();
    const dependsOn = row.cells[5]?.trim();

    if (!id || !id.startsWith("FR-")) continue;

    if (upsertEntity(db, id, "requirement", title, { track, priority, acceptanceCriteria: ac })) {
      entities++;
    } else {
      skipped++;
    }

    // Parse depends_on references (e.g., "FR-18", "FR-20, FR-21", "FR-25~FR-27")
    if (dependsOn && dependsOn !== "—" && dependsOn !== "-") {
      const depIds = expandRefs(dependsOn);
      for (const depId of depIds) {
        if (upsertDependsOn(db, id, depId)) relations++;
      }
    }
  }

  // ── 2. Non-Functional Requirements ────────
  const nfrTable = parseMarkdownTable(lines, /\|\s*ID\s*\|.*Track.*\|.*Category\s*\|/i);
  for (const row of nfrTable.rows) {
    const id = row.cells[0]?.trim();
    const track = row.cells[1]?.trim();
    const category = row.cells[2]?.trim();
    const title = row.cells[3]?.trim();
    const metric = row.cells[4]?.trim();

    if (!id || !id.startsWith("NFR-")) continue;

    if (upsertEntity(db, id, "requirement", title, { track, category, metric, nfr: true })) {
      entities++;
    } else {
      skipped++;
    }
  }

  // ── 3. Core Invariant ─────────────────────
  const ciTable = parseMarkdownTable(lines, /\|\s*Invariant\s*\|.*Related\s*FR\s*\|/i);
  let ciIndex = 0;
  for (const row of ciTable.rows) {
    ciIndex++;
    const invariant = row.cells[0]?.trim();
    const relatedFR = row.cells[1]?.trim();
    const mustHold = row.cells[2]?.trim();
    const mustFail = row.cells[3]?.trim();

    if (!invariant) continue;

    const ciId = `CI-${String(ciIndex).padStart(2, "0")}`;

    if (upsertEntity(db, ciId, "criterion", invariant, { mustHold, mustFail })) {
      entities++;
    } else {
      skipped++;
    }

    // Link CI → FR via constrains relation
    if (relatedFR && relatedFR !== "—") {
      const refIds = expandRefs(relatedFR);
      for (const refId of refIds) {
        if (upsertConstrains(db, ciId, refId)) relations++;
      }
    }
  }

  return { entities, relations, skipped };
}

// ── Helpers ─────────────────────────────────

function upsertEntity(
  db: SQLiteDatabase,
  id: string,
  type: EntityType,
  title: string,
  metadata: Record<string, unknown>,
): boolean {
  const existing = getEntity(db, id);
  if (existing) return false;
  try {
    addEntity(db, { id, type, title, metadata: { ...metadata, source: "prd-bootstrap" } });
    return true;
  } catch (_) {
    return false;
  }
}

function upsertDependsOn(db: SQLiteDatabase, fromId: string, toId: string): boolean {
  // Both entities must exist for relation to be created
  if (!getEntity(db, fromId) || !getEntity(db, toId)) return false;
  try {
    addRelation(db, { fromId, toId, type: "depends_on" as RelationType });
    return true;
  } catch (_) {
    return false;
  }
}

function upsertConstrains(db: SQLiteDatabase, criterionId: string, reqId: string): boolean {
  if (!getEntity(db, criterionId) || !getEntity(db, reqId)) return false;
  try {
    addRelation(db, { fromId: criterionId, toId: reqId, type: "constrains" as RelationType });
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Expand reference strings like "FR-25~FR-27" or "FR-20, FR-21" into individual IDs.
 */
export function expandRefs(raw: string): string[] {
  const ids: string[] = [];
  // Split by comma first
  const parts = raw.split(/,/).map(s => s.trim()).filter(Boolean);

  for (const part of parts) {
    // Range: FR-25~FR-27 or NFR-8~NFR-9
    const rangeMatch = part.match(/^([A-Z]+-?)(\d+)\s*[~～]\s*\1?(\d+)$/);
    if (rangeMatch) {
      const prefix = rangeMatch[1];
      const startStr = rangeMatch[2];
      const padLen = startStr.length;
      const start = parseInt(startStr, 10);
      const end = parseInt(rangeMatch[3], 10);
      for (let n = start; n <= end; n++) {
        ids.push(`${prefix}${String(n).padStart(padLen, "0")}`);
      }
    } else {
      // Single ref, possibly with surrounding text — extract ID pattern
      const idMatch = part.match(/([A-Z]+-\d+)/);
      if (idMatch) ids.push(idMatch[1]);
    }
  }

  return ids;
}
