/**
 * Vault Importer — Obsidian .md → knowledge graph (v0.6.5 VAULT FR-18).
 *
 * Reverse sync: detect .md changes in vault, update graph accordingly.
 * Called on session-start to pick up manual Obsidian edits.
 */

import { existsSync, readdirSync, statSync, readFileSync } from "node:fs";
import { join, relative, extname } from "node:path";
import type { SQLiteDatabase } from "../bus/sqlite-adapter.js";

// ── Types ───────────────────────────────────────

interface VaultChange {
  filePath: string;
  entityId: string | null;  // from frontmatter, null = new file
  content: string;
  frontmatter: Record<string, unknown>;
  wikilinks: string[];
  mtime: number;
}

export interface ImportResult {
  updated: number;
  created: number;
  errors: number;
}

// ── Frontmatter Parsing ─────────────────────────

function parseFrontmatter(content: string): { frontmatter: Record<string, unknown>; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: content };

  const raw = match[1];
  const body = match[2].trim();
  const fm: Record<string, unknown> = {};

  for (const line of raw.split("\n")) {
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    let val: string | string[] = line.slice(idx + 1).trim();

    // Parse [tag1, tag2] arrays
    if (val.startsWith("[") && val.endsWith("]")) {
      val = val.slice(1, -1).split(",").map(s => s.trim()).filter(Boolean);
    }
    fm[key] = val;
  }

  return { frontmatter: fm, body };
}

// ── Wikilink Extraction ─────────────────────────

function extractWikilinks(content: string): string[] {
  return [...content.matchAll(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g)].map(m => m[1]);
}

// ── File Scanner ────────────────────────────────

function scanVault(vaultRoot: string, sinceTimestamp: number): VaultChange[] {
  const changes: VaultChange[] = [];

  function walk(dir: string): void {
    let entries: string[];
    try { entries = readdirSync(dir); } catch { return; }

    for (const entry of entries) {
      const fullPath = join(dir, entry);
      let stat;
      try { stat = statSync(fullPath); } catch { continue; }

      if (stat.isDirectory()) {
        walk(fullPath);
      } else if (extname(entry) === ".md" && stat.mtimeMs > sinceTimestamp) {
        try {
          const raw = readFileSync(fullPath, "utf8");
          const { frontmatter, body } = parseFrontmatter(raw);
          const wikilinks = extractWikilinks(raw);

          changes.push({
            filePath: fullPath,
            entityId: (frontmatter.id as string) || null,
            content: body,
            frontmatter,
            wikilinks,
            mtime: stat.mtimeMs,
          });
        } catch { /* skip unreadable files */ }
      }
    }
  }

  walk(vaultRoot);
  return changes;
}

// ── Import Logic ────────────────────────────────

/**
 * Detect vault changes since last sync and update graph.
 *
 * @param db — SQLite database handle
 * @param vaultRoot — vault directory path
 * @param lastSyncTimestamp — timestamp of last sync (from kv_state)
 */
export function importVaultChanges(
  db: SQLiteDatabase,
  vaultRoot: string,
  lastSyncTimestamp: number,
): ImportResult {
  const result: ImportResult = { updated: 0, created: 0, errors: 0 };

  if (!existsSync(vaultRoot)) return result;

  // Scan wiki/ subdirectory (LLM-maintained layer), not raw/ or schema/
  const wikiRoot = join(vaultRoot, "wiki");
  const scanRoot = existsSync(wikiRoot) ? wikiRoot : vaultRoot;
  const changes = scanVault(scanRoot, lastSyncTimestamp);
  if (changes.length === 0) return result;

  const now = Date.now();

  for (const change of changes) {
    try {
      if (change.entityId) {
        // UPDATE existing entity
        const exists = db.prepare("SELECT id FROM entities WHERE id = ?").get(change.entityId);
        if (exists) {
          const updates: string[] = ["description = ?", "updated_at = ?"];
          const params: unknown[] = [change.content, now];

          if (change.frontmatter.status) {
            updates.push("status = ?");
            params.push(change.frontmatter.status as string);
          }

          params.push(change.entityId);
          db.prepare(`UPDATE entities SET ${updates.join(", ")} WHERE id = ?`).run(...params);
          result.updated++;
        } else {
          // ID in frontmatter but not in DB — create
          createFromChange(db, change, now);
          result.created++;
        }
      } else {
        // No ID — new file
        createFromChange(db, change, now);
        result.created++;
      }
    } catch {
      result.errors++;
    }
  }

  return result;
}

function createFromChange(db: SQLiteDatabase, change: VaultChange, now: number): void {
  const type = (change.frontmatter.type as string) || "Fact";
  const title = change.content.split("\n")[0]?.slice(0, 80) || "Untitled";
  const id = `vault-${now}-${Math.random().toString(36).slice(2, 8)}`;

  const metadata: Record<string, unknown> = {};
  if (change.frontmatter.tags) metadata.tags = change.frontmatter.tags;
  if (change.frontmatter.category) metadata.category = change.frontmatter.category;

  db.prepare(`
    INSERT OR IGNORE INTO entities (id, type, title, description, status, metadata, project_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, type, title, change.content,
    (change.frontmatter.status as string) || "active",
    JSON.stringify(metadata),
    (change.frontmatter.project as string) || null,
    now, now,
  );

  // Create edges from wikilinks
  for (const link of change.wikilinks) {
    // Find entity by slug-matching title
    const target = db.prepare(
      "SELECT id FROM entities WHERE LOWER(REPLACE(title, ' ', '-')) LIKE ? LIMIT 1"
    ).get(`%${link.toLowerCase()}%`) as { id: string } | undefined;

    if (target) {
      db.prepare(
        "INSERT OR IGNORE INTO relations (id, from_id, to_id, type, weight, metadata, created_at) VALUES (?, ?, ?, 'references', 1.0, '{}', ?)"
      ).run(`rel-${now}-${Math.random().toString(36).slice(2, 6)}`, id, target.id, now);
    }
  }
}
