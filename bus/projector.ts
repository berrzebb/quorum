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

  constructor(db: Database.Database, config: ProjectorConfig) {
    this.db = db;
    this.config = config;
  }

  /**
   * Query all current item states from SQLite.
   * This is the source of truth for what tags should be in markdown.
   */
  queryItemStates(): ItemState[] {
    try {
      // Use rowid as tiebreaker when created_at matches (same millisecond)
      const rows = this.db.prepare(`
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
      `).all() as Array<{
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
    if (inner === this.config.triggerTag.replace(/^\[|\]$/g, "")) return "review_needed";
    if (inner === this.config.agreeTag.replace(/^\[|\]$/g, "")) return "approved";
    if (inner === this.config.pendingTag.replace(/^\[|\]$/g, "")) return "changes_requested";
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
    let stale = false;
    for (const item of items) {
      const expectedTag = this.stateToTag(item.currentState);
      const entityPattern = new RegExp(
        item.entityId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      );

      // Find the line containing this entity ID
      const lines = current.split(/\r?\n/);
      for (const line of lines) {
        if (entityPattern.test(line)) {
          // Check if the expected tag is on this line
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
  selfHeal(watchFilePath: string, respondFilePath: string): ProjectionDiff[] {
    const diffs: ProjectionDiff[] = [];

    const watchDiff = this.checkStaleness(watchFilePath);
    if (watchDiff) diffs.push(watchDiff);

    const respondDiff = this.checkStaleness(respondFilePath);
    if (respondDiff) diffs.push(respondDiff);

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
   * Project the gpt.md (respond file) from SQLite state.
   * Updates verdict tags in the response file to match SQLite transitions.
   */
  projectGptMd(existingContent: string): string {
    const items = this.queryItemStates();
    if (items.length === 0) return existingContent;

    let content = existingContent;

    // Update tags in "## Agreed" section based on approved items
    const approvedIds = items
      .filter(i => i.currentState === "approved")
      .map(i => i.entityId);

    // Update tags in "## Final Verdict" section based on overall state
    const hasReviewNeeded = items.some(i => i.currentState === "review_needed");
    const hasChangesRequested = items.some(i => i.currentState === "changes_requested");

    // If all items are approved and content has CHANGES_REQUESTED verdict,
    // update to APPROVED
    if (!hasReviewNeeded && !hasChangesRequested && approvedIds.length > 0) {
      content = content.replace(
        /## Final Verdict\s*\n+\[CHANGES_REQUESTED\]/,
        `## Final Verdict\n\n[APPROVED]`,
      );
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
      const rows = this.db.prepare(`
        SELECT from_state, to_state, source, created_at
        FROM state_transitions
        WHERE entity_type = 'audit_item' AND entity_id = ?
        ORDER BY created_at ASC
      `).all(entityId) as Array<{
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
}
