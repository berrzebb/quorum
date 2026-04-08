/**
 * Vault Exporter — entities → Obsidian .md files (v0.6.5 VAULT FR-15~17).
 *
 * memory_write → node INSERT → this exporter → .md with frontmatter + wikilinks.
 * Obsidian graph view renders wikilinks as edges automatically.
 *
 * Vault structure (LLM Wiki 3-layer):
 *   vault/raw/                  — immutable source documents (human-curated)
 *   vault/wiki/                 — LLM-maintained pages (entities, summaries, cross-refs)
 *     wiki/{project}/facts/     wiki/{project}/patterns/
 *     wiki/global/              wiki/rules/{soft,hard,verified}/
 *     wiki/trends/              wiki/index.md  wiki/log.md
 *   vault/schema/               — agent entry points (CLAUDE.md, AGENTS.md links)
 */

import { mkdirSync, writeFileSync, existsSync, readdirSync, statSync, readFileSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { homedir } from "node:os";
import type { SQLiteDatabase } from "../bus/sqlite-adapter.js";

// ── Types ───────────────────────────────────────

interface EntityRow {
  id: string;
  type: string;
  title: string;
  description: string | null;
  status: string;
  metadata: string;
  project_id: string | null;
  created_at: number;
  updated_at: number;
}

interface RelationRow {
  from_id: string;
  to_id: string;
  type: string;
}

export interface ExportResult {
  path: string;
  created: boolean;
}

// ── Configuration ───────────────────────────────

function getVaultRoot(): string {
  // Priority: env var → config → default
  if (process.env.QUORUM_VAULT_PATH) return process.env.QUORUM_VAULT_PATH;

  try {
    const configPath = join(process.cwd(), ".claude", "quorum", "config.json");
    if (existsSync(configPath)) {
      const config = JSON.parse(readFileSync(configPath, "utf8"));
      if (config.vaultPath) return config.vaultPath;
    }
  } catch { /* config read failed */ }

  return join(homedir(), ".quorum", "vault");
}

// ── Slug Generation ─────────────────────────────

/** Convert a title to a filesystem-safe slug. */
function slug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\w\s가-힣-]/g, "")   // keep word chars, spaces, korean, hyphens
    .replace(/\s+/g, "-")             // spaces → hyphens
    .replace(/-+/g, "-")              // collapse multiple hyphens
    .slice(0, 60)                     // limit length
    || "untitled";
}

// ── Path Resolution ─────────────────────────────

/** Determine the vault file path for an entity (under wiki/ layer). */
function vaultPath(vaultRoot: string, entity: EntityRow): string {
  const wiki = join(vaultRoot, "wiki");
  const s = slug(entity.title);
  const typeDir = entity.type.toLowerCase() + "s"; // Fact→facts, Pattern→patterns

  if (entity.type === "Rule") {
    const level = entity.status || "soft";
    return join(wiki, "rules", level, `${s}.md`);
  }

  if (entity.type === "Trend") {
    return join(wiki, "trends", `${s}.md`);
  }

  if (entity.type === "Tag" || entity.type === "Category") {
    return join(wiki, "tags", `${s}.md`);
  }

  // Project-scoped vs global
  const scope = entity.project_id || "global";
  return join(wiki, scope, typeDir, `${s}.md`);
}

// ── Markdown Generation ─────────────────────────

function toISO(ts: number): string {
  return new Date(ts).toISOString();
}

function parseMeta(raw: string): Record<string, unknown> {
  try { return JSON.parse(raw); } catch { return {}; }
}

/** Build frontmatter YAML block. */
function buildFrontmatter(entity: EntityRow): string {
  const meta = parseMeta(entity.metadata);
  const lines = [
    "---",
    `id: ${entity.id}`,
    `type: ${entity.type}`,
    `status: ${entity.status}`,
  ];

  if (entity.project_id) lines.push(`project: ${entity.project_id}`);
  if (meta.tags && Array.isArray(meta.tags)) {
    lines.push(`tags: [${(meta.tags as string[]).join(", ")}]`);
  }
  if (meta.category) lines.push(`category: ${meta.category}`);

  lines.push(`created: ${toISO(entity.created_at)}`);
  lines.push(`updated: ${toISO(entity.updated_at)}`);
  lines.push("---");

  return lines.join("\n");
}

/** Build wikilink section from relations. */
function buildRelatedSection(db: SQLiteDatabase, entityId: string): string {
  const outgoing = db.prepare(
    "SELECT to_id, type FROM relations WHERE from_id = ? LIMIT 20"
  ).all(entityId) as RelationRow[];

  const incoming = db.prepare(
    "SELECT from_id, type FROM relations WHERE to_id = ? LIMIT 20"
  ).all(entityId) as RelationRow[];

  if (outgoing.length === 0 && incoming.length === 0) return "";

  const links = new Set<string>();

  for (const r of outgoing) {
    // Resolve target title for prettier wikilink
    const target = db.prepare("SELECT title FROM entities WHERE id = ?").get(r.to_id) as { title: string } | undefined;
    const label = target?.title || r.to_id;
    links.add(`[[${slug(label)}]] (${r.type})`);
  }

  for (const r of incoming) {
    const source = db.prepare("SELECT title FROM entities WHERE id = ?").get(r.from_id) as { title: string } | undefined;
    const label = source?.title || r.from_id;
    links.add(`[[${slug(label)}]] (${r.type})`);
  }

  if (links.size === 0) return "";

  return "\n\n## Related\n" + [...links].map(l => `- ${l}`).join("\n");
}

// ── Export Functions ─────────────────────────────

/**
 * Export a single entity to an Obsidian .md file.
 * Creates parent directories as needed.
 */
export function exportNode(db: SQLiteDatabase, entityId: string): ExportResult | null {
  const entity = db.prepare("SELECT * FROM entities WHERE id = ?").get(entityId) as EntityRow | undefined;
  if (!entity) return null;

  const vaultRoot = ensureVaultStructure();
  const filePath = vaultPath(vaultRoot, entity);

  // Build markdown content
  const frontmatter = buildFrontmatter(entity);
  const body = entity.description || entity.title;
  const related = buildRelatedSection(db, entityId);

  const content = `${frontmatter}\n\n${body}${related}\n`;

  // Write file
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, content, "utf8");

  // Log
  appendLog(vaultRoot, "export-node", entity.title);

  return { path: filePath, created: true };
}

/**
 * Ensure the 3-layer vault structure exists (raw/wiki/schema).
 */
export function ensureVaultStructure(vaultRoot?: string): string {
  const root = vaultRoot ?? getVaultRoot();
  for (const dir of ["raw", "wiki", "schema"]) {
    mkdirSync(join(root, dir), { recursive: true });
  }
  return root;
}

/**
 * Generate wiki/index.md — catalog of all wiki pages.
 */
function generateIndex(db: SQLiteDatabase, vaultRoot: string): void {
  const entities = db.prepare(
    "SELECT id, type, title, status, project_id, updated_at FROM entities WHERE type != 'Reference' ORDER BY type, title"
  ).all() as EntityRow[];

  const lines: string[] = [
    "---", "generated: true", `updated: ${new Date().toISOString()}`, "---",
    "", "# Wiki Index", "",
  ];

  let currentType = "";
  for (const e of entities) {
    if (e.type !== currentType) {
      currentType = e.type;
      lines.push(`## ${currentType}s`, "");
    }
    const s = slug(e.title);
    const scope = e.project_id || "global";
    const status = e.status !== "active" ? ` (${e.status})` : "";
    lines.push(`- [[${s}]] — ${e.title}${status}`);
  }

  lines.push("", `*${entities.length} pages*`, "");
  writeFileSync(join(vaultRoot, "wiki", "index.md"), lines.join("\n"), "utf8");
}

/**
 * Append to wiki/log.md — chronological record.
 */
function appendLog(vaultRoot: string, action: string, detail: string): void {
  const logPath = join(vaultRoot, "wiki", "log.md");
  const date = new Date().toISOString().slice(0, 10);
  const entry = `## [${date}] ${action} | ${detail}\n`;

  let existing = "";
  try { existing = readFileSync(logPath, "utf8"); } catch { /* new file */ }

  if (!existing) {
    existing = "# Wiki Log\n\nChronological record of wiki operations.\n\n";
  }

  writeFileSync(logPath, existing + entry, "utf8");
}

/**
 * Export all entities to vault. Used for initial sync or rebuild.
 */
export function exportAll(db: SQLiteDatabase): { exported: number; errors: number } {
  let exported = 0;
  let errors = 0;

  const vaultRoot = ensureVaultStructure();

  const entities = db.prepare("SELECT id FROM entities WHERE type != 'Reference' ORDER BY updated_at DESC LIMIT 500").all() as Array<{ id: string }>;

  for (const { id } of entities) {
    try {
      const result = exportNode(db, id);
      if (result) exported++;
    } catch {
      errors++;
    }
  }

  // Generate index + log
  generateIndex(db, vaultRoot);
  appendLog(vaultRoot, "export", `${exported} pages exported (${errors} errors)`);

  return { exported, errors };
}

/**
 * Get the vault root path (for external callers).
 */
export function getVaultPath(): string {
  return getVaultRoot();
}
