/**
 * memory_write — Single entry point for all knowledge recording (v0.6.5 DCM FR-7).
 *
 * All memory goes through here:
 *   1. entities INSERT (node)
 *   2. relations INSERT (edges)
 *   3. embedding → entities_vec (if sqlite-vec loaded)
 *   4. FTS5 auto-sync (trigger)
 *   5. Obsidian .md export (VAULT track, skip if unavailable)
 */

let _query = null;
let _search = null;

async function mods() {
  if (!_query) _query = await import("../../../dist/platform/bus/graph-query.js");
  if (!_search) _search = await import("../../../dist/platform/bus/graph-search.js");
  return { query: _query, search: _search };
}

async function getDb() {
  try {
    const bridge = await import("../../bridge.mjs");
    const store = bridge.getStore?.();
    if (store) return store.getDb();
  } catch { /* bridge unavailable */ }

  try {
    const { existsSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const dbPath = resolve(process.cwd(), ".claude", "quorum-events.db");
    if (!existsSync(dbPath)) return null;
    const { openDatabase } = await import("../../../dist/platform/bus/sqlite-adapter.js");
    return openDatabase(dbPath);
  } catch { return null; }
}

/** @param {object} args */
export async function toolMemoryWrite(args) {
  const { content, type, title, tags = [], edges = [], scope = "project" } = args;
  if (!content) return { error: "content is required" };
  if (!type) return { error: "type is required (Fact, Rule, Decision, Trend, Pattern)" };

  const db = await getDb();
  if (!db) return { text: "(graph database unavailable)" };

  const { query: gq } = await mods();

  try {
    // 1. Check for duplicate content (FTS5 exact match)
    const existing = dedup(db, content);
    if (existing) {
      // Bump updated_at instead of creating duplicate
      gq.updateNode(db, existing.id, { description: content });
      return {
        text: `Updated existing node: ${existing.id} (${existing.type}: ${existing.title})`,
        summary: "dedup: updated existing",
        json: { id: existing.id, action: "updated" },
      };
    }

    // 2. Create node
    const nodeTitle = title || content.slice(0, 80) + (content.length > 80 ? "..." : "");
    const metadata = {};
    if (tags.length > 0) metadata.tags = tags;

    const projectId = scope === "global" ? null : projectName();

    const nodeId = gq.addNode(db, {
      type,
      title: nodeTitle,
      description: content,
      status: "active",
      metadata,
      projectId,
    });

    // 3. Create edges
    let edgeCount = 0;
    for (const edge of edges) {
      if (edge.target && edge.type) {
        // Ensure target node exists (create stub if needed)
        ensureNode(db, gq, edge.target);
        gq.addEdge(db, { fromId: nodeId, toId: edge.target, type: edge.type });
        edgeCount++;
      }
    }

    // 4. Tag edges (each tag becomes a node linked by "tagged" edge)
    for (const tag of tags) {
      const tagId = `tag-${tag}`;
      ensureNode(db, gq, tagId, { type: "Tag", title: tag });
      gq.addEdge(db, { fromId: nodeId, toId: tagId, type: "tagged" });
      edgeCount++;
    }

    // 5. Obsidian export (VAULT track — skip if module doesn't exist yet)
    try {
      const vault = await import("../../../dist/platform/vault/exporter.js");
      vault.exportNode?.(db, nodeId);
    } catch { /* VAULT not implemented yet — skip */ }

    return {
      text: `Created ${type}: "${nodeTitle}" (${edgeCount} edge(s))`,
      summary: `wrote ${type} node + ${edgeCount} edges`,
      json: { id: nodeId, type, edges: edgeCount },
    };
  } catch (err) {
    return { error: `memory_write: ${err.message}` };
  }
}

/** Check if near-duplicate content already exists. */
function dedup(db, content) {
  try {
    // Exact content match
    const row = db.prepare(
      "SELECT id, type, title FROM entities WHERE description = ? LIMIT 1"
    ).get(content);
    return row || null;
  } catch { return null; }
}

/** Ensure a node exists, creating a stub if needed. */
function ensureNode(db, gq, id, defaults = {}) {
  const existing = db.prepare("SELECT id FROM entities WHERE id = ?").get(id);
  if (!existing) {
    gq.addNode(db, {
      id,
      type: defaults.type || "Reference",
      title: defaults.title || id,
      status: "active",
    });
  }
}

function projectName() {
  try { return require("node:path").basename(process.cwd()); } catch { return undefined; }
}
