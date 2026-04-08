/**
 * Vault Exporter — entities → Obsidian .md files (v0.6.5 VAULT FR-15~17).
 *
 * memory_write → node INSERT → this exporter → .md with frontmatter + wikilinks.
 * Obsidian graph view renders wikilinks as edges automatically.
 *
 * Vault structure (LLM Wiki 3-layer):
 *   vault/raw/sessions/{date}/  — immutable session JSONL (ingest copies)
 *   vault/wiki/                 — LLM-maintained pages (Obsidian-compatible)
 *     wiki/global/{agents,decisions,facts,patterns}/
 *     wiki/rules/{draft,...}/   wiki/trends/
 *     wiki/index.md             wiki/log.md  wiki/GRAPH_REPORT.md
 *   vault/schema/               — agent entry points (CLAUDE.md, AGENTS.md links)
 *   vault/.store/               — vault.db + models/ (internal)
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
export function slug(title: string): string {
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
    const target = db.prepare("SELECT title FROM entities WHERE id = ?").get(r.to_id) as { title: string } | undefined;
    const label = target?.title || r.to_id;
    links.add(`[[${slug(label)}|${label}]] (${r.type})`);
  }

  for (const r of incoming) {
    const source = db.prepare("SELECT title FROM entities WHERE id = ?").get(r.from_id) as { title: string } | undefined;
    const label = source?.title || r.from_id;
    links.add(`[[${slug(label)}|${label}]] (${r.type})`);
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
 * Ensure the vault directory structure exists (raw/wiki/schema/.store).
 */
export function ensureVaultStructure(vaultRoot?: string): string {
  const root = vaultRoot ?? getVaultRoot();
  for (const dir of ["raw", "wiki", "schema", ".store"]) {
    mkdirSync(join(root, dir), { recursive: true });
  }
  return root;
}

/**
 * Generate wiki/index.md — catalog of all wiki pages.
 *
 * Karpathy pattern: category-grouped, 1-line description, wikilinks.
 * LLM reads index first to locate relevant pages before drilling in.
 */
export function generateIndex(db: SQLiteDatabase, vaultRoot: string): void {
  const entities = db.prepare(
    "SELECT id, type, title, description, status, project_id, updated_at FROM entities WHERE type != 'Reference' ORDER BY type, title"
  ).all() as EntityRow[];

  const lines: string[] = [
    "---", "generated: true", `updated: ${new Date().toISOString()}`, "---",
    "", "# Wiki Index", "",
    `> ${entities.length} pages across ${new Set(entities.map(e => e.type)).size} categories.`,
    "",
  ];

  let currentType = "";
  for (const e of entities) {
    if (e.type !== currentType) {
      currentType = e.type;
      lines.push(`## ${currentType}s`, "");
    }
    const s = slug(e.title);
    const desc = e.description?.split("\n")[0]?.slice(0, 80) ?? "";
    const status = e.status !== "active" ? ` \`${e.status}\`` : "";
    lines.push(`- [[${s}|${e.title}]]${status} — ${desc}`);
  }

  lines.push("");
  writeFileSync(join(vaultRoot, "wiki", "index.md"), lines.join("\n"), "utf8");
}

/**
 * Append to wiki/log.md — chronological record.
 *
 * Karpathy pattern: append-only, parseable prefix `## [YYYY-MM-DD] action | detail`.
 * Searchable with grep/FTS. Timeline of wiki evolution.
 */
function appendLog(vaultRoot: string, action: string, detail: string): void {
  const logPath = join(vaultRoot, "wiki", "log.md");
  const date = new Date().toISOString().slice(0, 10);
  const entry = `## [${date}] ${action} | ${detail}\n`;

  let existing = "";
  try { existing = readFileSync(logPath, "utf8"); } catch { /* new file */ }

  if (!existing) {
    existing = [
      "---", "generated: true", `created: ${new Date().toISOString()}`, "---",
      "", "# Wiki Log", "",
      "> Append-only chronological record. Each entry: `## [date] action | detail`.",
      "", "",
    ].join("\n");
  }

  writeFileSync(logPath, existing + entry, "utf8");
}

/**
 * Generate wiki/overview.md — high-level synthesis of the entire wiki.
 *
 * Karpathy pattern: the "birds-eye view" page. Summarizes entity distribution,
 * active trends, recent decisions, and key patterns. Updated on each build.
 */
export function generateOverview(db: SQLiteDatabase, vaultRoot: string): void {
  const lines: string[] = [
    "---", "generated: true", `updated: ${new Date().toISOString()}`, "---",
    "", "# Wiki Overview", "",
  ];

  // Entity distribution
  const typeCounts = db.prepare(
    "SELECT type, COUNT(*) as c FROM entities WHERE type != 'Reference' GROUP BY type ORDER BY c DESC"
  ).all() as Array<{ type: string; c: number }>;
  const total = typeCounts.reduce((s, t) => s + t.c, 0);

  lines.push("## Knowledge Base");
  lines.push("");
  lines.push(`**${total}** entities in this wiki:`);
  lines.push("");
  for (const { type, c } of typeCounts) {
    const bar = "█".repeat(Math.max(1, Math.round((c / total) * 20)));
    lines.push(`- **${type}** ${bar} ${c}`);
  }
  lines.push("");

  // Recent activity (entities updated in last 7 days)
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const recent = db.prepare(
    "SELECT type, title, updated_at FROM entities WHERE updated_at > ? AND type != 'Reference' ORDER BY updated_at DESC LIMIT 10"
  ).all(weekAgo) as Array<{ type: string; title: string; updated_at: number }>;

  if (recent.length > 0) {
    lines.push("## Recent Activity");
    lines.push("");
    for (const r of recent) {
      const date = new Date(r.updated_at).toISOString().slice(0, 10);
      lines.push(`- \`${date}\` [[${slug(r.title)}|${r.title}]] (${r.type})`);
    }
    lines.push("");
  }

  // Active rules
  const rules = db.prepare(
    "SELECT title, description, status FROM entities WHERE type = 'Rule' ORDER BY status DESC, title"
  ).all() as Array<{ title: string; description: string | null; status: string }>;

  if (rules.length > 0) {
    lines.push("## Active Rules");
    lines.push("");
    for (const r of rules) {
      const desc = r.description?.split("\n")[0]?.slice(0, 80) ?? "";
      lines.push(`- [[${slug(r.title)}|${r.title}]] \`${r.status}\` — ${desc}`);
    }
    lines.push("");
  }

  // Decisions
  const decisions = db.prepare(
    "SELECT title, description FROM entities WHERE type = 'Decision' ORDER BY updated_at DESC LIMIT 10"
  ).all() as Array<{ title: string; description: string | null }>;

  if (decisions.length > 0) {
    lines.push("## Key Decisions");
    lines.push("");
    for (const d of decisions) {
      const desc = d.description?.split("\n")[0]?.slice(0, 80) ?? "";
      lines.push(`- [[${slug(d.title)}|${d.title}]] — ${desc}`);
    }
    lines.push("");
  }

  // Trends
  const trends = db.prepare(
    "SELECT title, description FROM entities WHERE type = 'Trend' ORDER BY updated_at DESC LIMIT 10"
  ).all() as Array<{ title: string; description: string | null }>;

  if (trends.length > 0) {
    lines.push("## Trends");
    lines.push("");
    for (const t of trends) {
      const desc = t.description?.split("\n")[0]?.slice(0, 80) ?? "";
      lines.push(`- [[${slug(t.title)}|${t.title}]] — ${desc}`);
    }
    lines.push("");
  }

  // Patterns (recent failures/successes)
  const patterns = db.prepare(
    "SELECT title, description FROM entities WHERE type = 'Pattern' ORDER BY updated_at DESC LIMIT 10"
  ).all() as Array<{ title: string; description: string | null }>;

  if (patterns.length > 0) {
    lines.push("## Patterns");
    lines.push("");
    for (const p of patterns) {
      const desc = p.description?.split("\n")[0]?.slice(0, 80) ?? "";
      lines.push(`- [[${slug(p.title)}|${p.title}]] — ${desc}`);
    }
    lines.push("");
  }

  // Graph summary (relation count)
  try {
    const relCount = db.prepare("SELECT COUNT(*) as c FROM relations").get() as { c: number };
    const edgeTypes = db.prepare(
      "SELECT type, COUNT(*) as c FROM relations GROUP BY type ORDER BY c DESC LIMIT 5"
    ).all() as Array<{ type: string; c: number }>;

    lines.push("## Graph");
    lines.push("");
    lines.push(`**${relCount.c}** connections between entities.`);
    if (edgeTypes.length > 0) {
      lines.push("");
      for (const e of edgeTypes) {
        lines.push(`- \`${e.type}\` × ${e.c}`);
      }
    }
    lines.push("");
    lines.push("See [[GRAPH_REPORT|Graph Report]] for community analysis.");
    lines.push("");
  } catch { /* relations table may not exist */ }

  // Navigation
  lines.push("## Navigation");
  lines.push("");
  lines.push("- [[index|Index]] — full page catalog");
  lines.push("- [[log|Log]] — chronological history");
  lines.push("- [[GRAPH_REPORT|Graph Report]] — community & hub analysis");
  lines.push("");

  mkdirSync(join(vaultRoot, "wiki"), { recursive: true });
  writeFileSync(join(vaultRoot, "wiki", "overview.md"), lines.join("\n"), "utf8");
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
 * Build schema/AGENTS.md — auto-generated agent guide from vault state.
 *
 * Scans wiki/ structure, reads rules, counts entities, and writes
 * a comprehensive reference that any agent (Claude, Codex, Gemini) can follow.
 */
export function buildSchema(db: SQLiteDatabase, vaultRoot?: string): string {
  const root = vaultRoot ?? getVaultRoot();
  const schemaDir = join(root, "schema");
  mkdirSync(schemaDir, { recursive: true });

  // ── Gather vault state ──

  // Entity counts by type
  const typeCounts = db.prepare(
    "SELECT type, COUNT(*) as c FROM entities WHERE type != 'Reference' GROUP BY type ORDER BY c DESC"
  ).all() as Array<{ type: string; c: number }>;

  // Active rules
  const rules = db.prepare(
    "SELECT title, description, status FROM entities WHERE type = 'Rule' ORDER BY status, title"
  ).all() as Array<{ title: string; description: string | null; status: string }>;

  // Scan wiki/ subdirectories
  const wikiDirs: string[] = [];
  function scanDirs(dir: string, prefix: string): void {
    try {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        try {
          if (statSync(full).isDirectory() && !entry.startsWith(".")) {
            const rel = prefix ? `${prefix}/${entry}` : entry;
            wikiDirs.push(rel);
            scanDirs(full, rel);
          }
        } catch { /* skip */ }
      }
    } catch { /* skip */ }
  }
  scanDirs(join(root, "wiki"), "");

  // ── Generate AGENTS.md ──

  const lines: string[] = [];

  lines.push("---");
  lines.push("generated: true");
  lines.push(`updated: ${new Date().toISOString()}`);
  lines.push("---");
  lines.push("");
  lines.push("# Vault AGENTS Guide");
  lines.push("");
  lines.push("> Auto-generated from vault state. Do not edit manually — run `quorum vault schema` to rebuild.");
  lines.push("");

  // Structure
  lines.push("## Vault Structure");
  lines.push("");
  lines.push("```");
  lines.push("vault/");
  lines.push("├── raw/sessions/{date}/   # Immutable session JSONL");
  lines.push("├── wiki/                  # LLM-maintained knowledge (Obsidian)");
  for (const d of wikiDirs) {
    const depth = d.split("/").length;
    const indent = "│   ".repeat(depth);
    const name = d.split("/").pop()!;
    lines.push(`${indent}├── ${name}/`);
  }
  lines.push("├── schema/                # This file — agent entry points");
  lines.push("└── .store/                # vault.db + BGE-M3 model");
  lines.push("```");
  lines.push("");

  // Entity types
  lines.push("## Entity Types");
  lines.push("");
  lines.push("| Type | Count | Location |");
  lines.push("|------|-------|----------|");
  for (const { type, c } of typeCounts) {
    const dir = type === "Rule" ? "wiki/rules/{status}/"
      : type === "Trend" ? "wiki/trends/"
      : `wiki/global/${type.toLowerCase()}s/`;
    lines.push(`| ${type} | ${c} | \`${dir}\` |`);
  }
  lines.push("");

  // Page format
  lines.push("## Page Format");
  lines.push("");
  lines.push("All wiki pages use this frontmatter:");
  lines.push("");
  lines.push("```yaml");
  lines.push("---");
  lines.push("id: ent-{type}-{n}");
  lines.push("type: Fact | Pattern | Decision | Rule | Trend | Agent");
  lines.push("status: draft | active | verified | deprecated");
  lines.push("created: ISO-8601");
  lines.push("updated: ISO-8601");
  lines.push("---");
  lines.push("```");
  lines.push("");
  lines.push("Filename = `slug(title).md`. Wikilinks use `[[slug|title]]` alias format.");
  lines.push("");

  // Rules
  if (rules.length > 0) {
    lines.push("## Rules");
    lines.push("");
    for (const r of rules) {
      const s = slug(r.title);
      const desc = r.description?.split("\n")[0] ?? "";
      lines.push(`- **[[${s}|${r.title}]]** (${r.status}) — ${desc}`);
    }
    lines.push("");
  }

  // Tools
  lines.push("## Available Tools");
  lines.push("");
  lines.push("| Tool | Purpose |");
  lines.push("|------|---------|");
  lines.push("| `recall` | Hybrid search (BM25 + vector) across session turns |");
  lines.push("| `search` | Wiki/entity search via graph |");
  lines.push("| `memory_write` | Create entity → wiki page + graph edge |");
  lines.push("");

  // CLI
  lines.push("## CLI Commands");
  lines.push("");
  lines.push("```bash");
  lines.push("quorum vault status            # DB stats");
  lines.push("quorum vault ingest --auto     # Ingest sessions → vault.db");
  lines.push("quorum vault search <query>    # FTS keyword search");
  lines.push("quorum vault graph             # Graph analysis → GRAPH_REPORT.md");
  lines.push("quorum vault schema            # Rebuild this file");
  lines.push("```");
  lines.push("");

  // Conventions
  lines.push("## Conventions");
  lines.push("");
  lines.push("1. **Read before write** — `recall` or `search` before creating new entities");
  lines.push("2. **One fact per page** — avoid mega-pages; split into focused entities");
  lines.push("3. **Wikilink liberally** — `[[slug|title]]` creates graph edges on import");
  lines.push("4. **Rules are law** — Rule entities override general patterns");
  lines.push("5. **Draft → verified** — new knowledge starts as draft, promote when confirmed");
  lines.push("");

  const content = lines.join("\n");
  const agentsPath = join(schemaDir, "AGENTS.md");
  writeFileSync(agentsPath, content, "utf8");

  // Also rebuild wiki meta-files
  generateIndex(db, root);
  generateOverview(db, root);

  appendLog(root, "schema-build", `AGENTS.md + index + overview (${typeCounts.length} types, ${rules.length} rules)`);

  return agentsPath;
}

/**
 * Get the vault root path (for external callers).
 */
export function getVaultPath(): string {
  return getVaultRoot();
}
