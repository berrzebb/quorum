/**
 * Rule Registry — structural storage for auto-learned and manual enforcement rules.
 *
 * PRD § FR-19: violation tracking. PRD § FR-20: SOFT→HARD promotion.
 * Uses the same SQLite database as EventStore (shared connection).
 *
 * @module bus/rule-registry
 */

import type { SQLiteDatabase } from "./sqlite-adapter.js";
import { randomUUID } from "node:crypto";

// ── Types ────────────────────────────────────────

export type RuleLevel = "candidate" | "soft" | "hard" | "verified" | "archived";

export interface Rule {
  id: string;
  pattern: string;
  description: string;
  source: "auto-learn" | "manual";
  level: RuleLevel;
  violationCount: number;
  lastViolated: number | null;
  createdAt: number;
  promotedAt: number | null;
}

export interface RuleCandidate {
  pattern: string;
  description: string;
  source?: "auto-learn" | "manual";
}

export interface RuleFilter {
  level?: RuleLevel;
  minViolations?: number;
  source?: string;
}

// ── Registry ─────────────────────────────────────

export class RuleRegistry {
  private db: SQLiteDatabase;

  constructor(db: SQLiteDatabase) {
    this.db = db;
    this.createSchema();
  }

  private createSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS rules (
        id              TEXT PRIMARY KEY,
        pattern         TEXT NOT NULL,
        description     TEXT NOT NULL,
        source          TEXT NOT NULL DEFAULT 'auto-learn',
        level           TEXT NOT NULL DEFAULT 'candidate',
        violation_count INTEGER NOT NULL DEFAULT 0,
        last_violated   INTEGER,
        created_at      INTEGER NOT NULL,
        promoted_at     INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_rules_level
        ON rules (level);
    `);
  }

  /** Add a new rule. Returns the rule ID. */
  addRule(candidate: RuleCandidate): string {
    // Dedup by pattern
    const existing = this.db.prepare(
      "SELECT id FROM rules WHERE pattern = ? AND level != 'archived'",
    ).get(candidate.pattern) as { id: string } | undefined;
    if (existing) return existing.id;

    const id = randomUUID();
    const now = Date.now();
    this.db.prepare(
      "INSERT INTO rules (id, pattern, description, source, level, violation_count, created_at) VALUES (?, ?, ?, ?, 'candidate', 0, ?)",
    ).run(id, candidate.pattern, candidate.description, candidate.source ?? "auto-learn", now);
    return id;
  }

  /** Record a violation for a rule. Increments count and updates timestamp. */
  recordViolation(ruleId: string): void {
    this.db.prepare(
      "UPDATE rules SET violation_count = violation_count + 1, last_violated = ? WHERE id = ?",
    ).run(Date.now(), ruleId);
  }

  /** Get a single rule by ID. */
  getRule(id: string): Rule | null {
    const row = this.db.prepare("SELECT * FROM rules WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return row ? this.mapRow(row) : null;
  }

  /** Query rules with optional filters. */
  getRules(filter: RuleFilter = {}): Rule[] {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (filter.level) { conditions.push("level = ?"); params.push(filter.level); }
    if (filter.minViolations != null) { conditions.push("violation_count >= ?"); params.push(filter.minViolations); }
    if (filter.source) { conditions.push("source = ?"); params.push(filter.source); }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const rows = this.db.prepare(
      `SELECT * FROM rules ${where} ORDER BY violation_count DESC`,
    ).all(...params) as Array<Record<string, unknown>>;
    return rows.map(r => this.mapRow(r));
  }

  /** Promote a rule to a new level. Records promotion timestamp. */
  promoteRule(id: string, newLevel: RuleLevel): void {
    this.db.prepare(
      "UPDATE rules SET level = ?, promoted_at = ? WHERE id = ?",
    ).run(newLevel, Date.now(), id);
  }

  private mapRow(r: Record<string, unknown>): Rule {
    return {
      id: r.id as string,
      pattern: r.pattern as string,
      description: r.description as string,
      source: r.source as "auto-learn" | "manual",
      level: r.level as RuleLevel,
      violationCount: r.violation_count as number,
      lastViolated: r.last_violated as number | null,
      createdAt: r.created_at as number,
      promotedAt: r.promoted_at as number | null,
    };
  }
}
