/**
 * Markdown Projector — generates markdown files from SQLite state.
 *
 * This is the "view" layer: SQLite is the source of truth,
 * markdown files are read-only projections for human consumption.
 *
 * Phase 3 (current): Dual-write mode — existing markdown writes continue,
 * projector runs alongside for self-healing and daemon state queries.
 *
 * Phase 3+ (future): Projector becomes the sole markdown writer.
 */

import { existsSync, readFileSync } from "node:fs";
import type Database from "better-sqlite3";
import { COMMITTEE_IDS } from "./meeting-log.js";

// ── Types ────────────────────────────────────

export interface ProjectorConfig {
  triggerTag: string;
  agreeTag: string;
  pendingTag: string;
}

export interface ItemState {
  entityId: string;
  currentState: string;
  source: string;
  metadata: Record<string, unknown>;
  createdAt: number;
}

export interface ProjectionDiff {
  path: string;
  stale: boolean;
  /** Projected content from SQLite state. */
  projected: string;
  /** Current content on disk. */
  current: string;
}

// ── Projector ────────────────────────────────

export class MarkdownProjector {
  private db: Database.Database;
  private config: ProjectorConfig;

  // ── Pre-computed stripped tag values ──
  private strippedTrigger: string;
  private strippedAgree: string;
  private strippedPending: string;

  // ── Cached prepared statements ──
  private stmtItemStates: Database.Statement;
  private stmtEntityHistory: Database.Statement;

  // ── Parliament prepared statements ──
  private stmtParliamentSessions: Database.Statement;
  private stmtParliamentAmendments: Database.Statement;
  private stmtParliamentConvergence: Database.Statement;
  private stmtParliamentCPS: Database.Statement;

  constructor(db: Database.Database, config: ProjectorConfig) {
    this.db = db;
    this.config = config;

    this.strippedTrigger = config.triggerTag.replace(/^\[|\]$/g, "");
    this.strippedAgree = config.agreeTag.replace(/^\[|\]$/g, "");
    this.strippedPending = config.pendingTag.replace(/^\[|\]$/g, "");

    // Parliament views — read from events table
    this.stmtParliamentSessions = db.prepare(`
      SELECT payload, timestamp FROM events
      WHERE event_type = 'parliament.session.digest'
      ORDER BY timestamp DESC LIMIT 20
    `);
    this.stmtParliamentAmendments = db.prepare(`
      SELECT event_type, payload, timestamp FROM events
      WHERE event_type IN ('parliament.amendment.propose', 'parliament.amendment.vote', 'parliament.amendment.resolve')
      ORDER BY timestamp DESC LIMIT 50
    `);
    this.stmtParliamentConvergence = db.prepare(`
      SELECT payload, timestamp FROM events
      WHERE event_type = 'parliament.convergence'
      ORDER BY timestamp DESC LIMIT 10
    `);
    this.stmtParliamentCPS = db.prepare(`
      SELECT payload, timestamp FROM events
      WHERE event_type = 'parliament.cps.generated'
      ORDER BY timestamp DESC LIMIT 5
    `);

    this.stmtItemStates = db.prepare(`
      SELECT entity_id, to_state AS current_state, source, metadata, created_at
      FROM state_transitions st1
      WHERE entity_type = 'audit_item'
        AND rowid = (
          SELECT rowid FROM state_transitions st2
          WHERE st2.entity_type = st1.entity_type
            AND st2.entity_id = st1.entity_id
          ORDER BY st2.created_at DESC, st2.rowid DESC
          LIMIT 1
        )
      ORDER BY created_at ASC
    `);
    this.stmtEntityHistory = db.prepare(`
      SELECT from_state, to_state, source, created_at
      FROM state_transitions
      WHERE entity_type = 'audit_item' AND entity_id = ?
      ORDER BY created_at ASC
    `);
  }

  /**
   * Query all current item states from SQLite.
   * This is the source of truth for what tags should be in markdown.
   */
  queryItemStates(): ItemState[] {
    try {
      const rows = this.stmtItemStates.all() as Array<{
        entity_id: string;
        current_state: string;
        source: string;
        metadata: string;
        created_at: number;
      }>;

      return rows.map(row => ({
        entityId: row.entity_id,
        currentState: row.current_state,
        source: row.source,
        metadata: JSON.parse(row.metadata),
        createdAt: row.created_at,
      }));
    } catch {
      return [];
    }
  }

  /**
   * Convert a state name to the configured markdown tag.
   */
  stateToTag(state: string): string {
    switch (state) {
      case "review_needed": return this.config.triggerTag;
      case "approved": return this.config.agreeTag;
      case "changes_requested": return this.config.pendingTag;
      case "infra_failure": return "[INFRA_FAILURE]";
      default: return `[${state.toUpperCase()}]`;
    }
  }

  /**
   * Convert a markdown tag to a state name.
   */
  tagToState(tag: string): string {
    const inner = tag.replace(/^\[|\]$/g, "");
    if (inner === this.strippedTrigger) return "review_needed";
    if (inner === this.strippedAgree) return "approved";
    if (inner === this.strippedPending) return "changes_requested";
    if (inner === "INFRA_FAILURE") return "infra_failure";
    return inner.toLowerCase();
  }

  /**
   * Generate a summary of current audit item states.
   * Used by daemon TUI's StateReader for display.
   */
  generateStateSummary(): string {
    const items = this.queryItemStates();
    if (items.length === 0) return "No audit items tracked.";

    const lines = [`## Audit Items (${items.length})\n`];
    const byState = new Map<string, ItemState[]>();

    for (const item of items) {
      const group = byState.get(item.currentState) ?? [];
      group.push(item);
      byState.set(item.currentState, group);
    }

    for (const [state, stateItems] of byState) {
      const tag = this.stateToTag(state);
      lines.push(`### ${tag} (${stateItems.length})\n`);
      for (const item of stateItems) {
        const meta = item.metadata;
        const label = (meta.label as string) ?? item.entityId;
        lines.push(`- ${tag} ${label}`);
      }
      lines.push("");
    }

    return lines.join("\n");
  }

  /**
   * Check if a markdown file's tag states match SQLite state.
   * Returns diff info if stale, null if in sync.
   */
  checkStaleness(filePath: string): ProjectionDiff | null {
    if (!existsSync(filePath)) return null;

    const items = this.queryItemStates();
    if (items.length === 0) return null;

    const current = readFileSync(filePath, "utf8");

    // Check if every item's tag in the file matches its SQLite state
    const lines = current.split(/\r?\n/);
    let stale = false;
    for (const item of items) {
      const expectedTag = this.stateToTag(item.currentState);

      for (const line of lines) {
        if (line.includes(item.entityId)) {
          if (!line.includes(expectedTag)) {
            stale = true;
            break;
          }
        }
      }
      if (stale) break;
    }

    if (!stale) return null;

    return {
      path: filePath,
      stale: true,
      projected: this.generateStateSummary(),
      current,
    };
  }

  /**
   * Self-heal: check all tracked markdown files and report staleness.
   * Used by daemon periodic timer.
   */
  selfHeal(watchFilePath: string): ProjectionDiff[] {
    const diffs: ProjectionDiff[] = [];

    const watchDiff = this.checkStaleness(watchFilePath);
    if (watchDiff) diffs.push(watchDiff);

    return diffs;
  }

  /**
   * Project the claude.md (watch file) from SQLite state.
   * Generates the tag-annotated item list section.
   */
  projectClaudeMd(existingContent: string): string {
    const items = this.queryItemStates();
    if (items.length === 0) return existingContent;

    let content = existingContent;
    for (const item of items) {
      const expectedTag = this.stateToTag(item.currentState);
      const entityEscaped = item.entityId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

      // Replace any existing tag on the line containing this entity ID
      const tagPattern = new RegExp(
        `(\\[(?:REVIEW_NEEDED|APPROVED|CHANGES_REQUESTED|INFRA_FAILURE)\\])\\s*(${entityEscaped})`,
        "g",
      );
      content = content.replace(tagPattern, `${expectedTag} $2`);
    }

    return content;
  }

  /**
   * Get state transition history for an entity.
   */
  entityHistory(entityId: string): Array<{
    fromState: string | null;
    toState: string;
    source: string;
    createdAt: number;
  }> {
    try {
      const rows = this.stmtEntityHistory.all(entityId) as Array<{
        from_state: string | null;
        to_state: string;
        source: string;
        created_at: number;
      }>;
      return rows.map(r => ({
        fromState: r.from_state,
        toState: r.to_state,
        source: r.source,
        createdAt: r.created_at,
      }));
    } catch {
      return [];
    }
  }

  // ── Parliament Views ──────────────────────────

  /**
   * Generate a session digest markdown — recent parliament sessions.
   */
  projectSessionDigest(): string {
    try {
      const rows = this.stmtParliamentSessions.all() as Array<{ payload: string; timestamp: number }>;
      if (rows.length === 0) return "No parliament sessions recorded.";

      const lines = [`## Parliament Sessions (recent ${rows.length})\n`];
      for (const row of rows) {
        const p = JSON.parse(row.payload);
        const date = new Date(row.timestamp).toISOString().slice(0, 16).replace("T", " ");
        const type = p.sessionType ?? "unknown";
        const agenda = p.agendaItems?.join(", ") ?? p.agendaId ?? "—";
        const score = typeof p.convergenceScore === "number" ? p.convergenceScore.toFixed(2) : "—";
        const cls = p.classifications ?? {};
        const clsSummary = Object.entries(cls).map(([k, v]) => `${k}:${v}`).join(" ");
        lines.push(`### ${date} (${type})`);
        lines.push(`- **Agenda**: ${agenda}`);
        lines.push(`- **Convergence**: ${score}`);
        if (clsSummary) lines.push(`- **Classifications**: ${clsSummary}`);
        if (p.summary) lines.push(`- **Summary**: ${p.summary}`);
        lines.push("");
      }
      return lines.join("\n");
    } catch {
      return "Parliament session data unavailable.";
    }
  }

  /**
   * Generate an amendment log markdown — proposed/voted/resolved amendments.
   */
  projectAmendmentLog(): string {
    try {
      const rows = this.stmtParliamentAmendments.all() as Array<{
        event_type: string; payload: string; timestamp: number;
      }>;
      if (rows.length === 0) return "No amendments recorded.";

      // Group by amendmentId
      const amendments = new Map<string, { events: Array<{ type: string; payload: Record<string, unknown>; timestamp: number }> }>();
      for (const row of rows) {
        const p = JSON.parse(row.payload);
        const id = (p.amendmentId as string) ?? "unknown";
        if (!amendments.has(id)) amendments.set(id, { events: [] });
        amendments.get(id)!.events.push({ type: row.event_type, payload: p, timestamp: row.timestamp });
      }

      const lines = [`## Amendment Log (${amendments.size} amendments)\n`];
      for (const [id, data] of amendments) {
        const propose = data.events.find(e => e.type === "parliament.amendment.propose");
        const votes = data.events.filter(e => e.type === "parliament.amendment.vote");
        const resolve = data.events.find(e => e.type === "parliament.amendment.resolve");

        const target = (propose?.payload.target as string) ?? "—";
        const status = (resolve?.payload.status as string) ?? "pending";
        lines.push(`### ${id.slice(0, 8)} — ${status}`);
        lines.push(`- **Target**: ${target}`);
        if (propose?.payload.change) lines.push(`- **Change**: ${propose.payload.change}`);
        lines.push(`- **Votes**: ${votes.length} cast`);
        for (const v of votes) {
          lines.push(`  - ${v.payload.voter}: ${v.payload.position} (confidence: ${v.payload.confidence ?? "—"})`);
        }
        lines.push("");
      }
      return lines.join("\n");
    } catch {
      return "Amendment data unavailable.";
    }
  }

  /**
   * Generate convergence status markdown — per-agenda convergence tracking.
   */
  projectConvergenceStatus(): string {
    try {
      const rows = this.stmtParliamentConvergence.all() as Array<{ payload: string; timestamp: number }>;
      if (rows.length === 0) return "No convergence data recorded.";

      const latest = new Map<string, { converged: boolean; stableRounds: number; threshold: number; score: number; timestamp: number }>();

      for (const row of rows) {
        const p = JSON.parse(row.payload);
        const agenda = (p.agendaId as string) ?? "unknown";
        if (!latest.has(agenda)) {
          latest.set(agenda, {
            converged: p.converged ?? false,
            stableRounds: p.stableRounds ?? 0,
            threshold: p.threshold ?? 2,
            score: p.convergenceScore ?? 0,
            timestamp: row.timestamp,
          });
        }
      }

      const lines = ["## Convergence Status\n"];
      lines.push("| Committee | Status | Stable | Score |");
      lines.push("|-----------|--------|--------|-------|");

      for (const c of COMMITTEE_IDS) {
        const data = latest.get(c);
        if (data) {
          const status = data.converged ? "converged" : "pending";
          lines.push(`| ${c} | ${status} | ${data.stableRounds}/${data.threshold} | ${data.score.toFixed(2)} |`);
        } else {
          lines.push(`| ${c} | — | 0/2 | — |`);
        }
      }
      lines.push("");

      return lines.join("\n");
    } catch {
      return "Convergence data unavailable.";
    }
  }

  /**
   * Generate CPS (Context-Problem-Solution) markdown from parliament events.
   */
  projectCPS(): string {
    try {
      const rows = this.stmtParliamentCPS.all() as Array<{ payload: string; timestamp: number }>;
      if (rows.length === 0) return "No CPS generated yet.";

      const lines = [`## CPS Documents (${rows.length})\n`];
      for (const row of rows) {
        const p = JSON.parse(row.payload);
        const date = new Date(row.timestamp).toISOString().slice(0, 16).replace("T", " ");
        const agenda = (p.agendaId as string) ?? "—";
        lines.push(`### ${agenda} (${date})`);
        lines.push(`**Context**: ${p.context ?? "—"}`);
        lines.push(`**Problem**: ${p.problem ?? "—"}`);
        lines.push(`**Solution**: ${p.solution ?? "—"}`);
        lines.push(`Gaps: ${p.gapCount ?? 0}, Builds: ${p.buildCount ?? 0}`);
        lines.push("");
      }
      return lines.join("\n");
    } catch {
      return "CPS data unavailable.";
    }
  }
}
