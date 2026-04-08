/**
 * search — MCP tool for searching the vault wiki (entities/knowledge graph).
 *
 * Searches entities + relations via FTS5, returns structured knowledge.
 * Reuses existing graph-search.ts infrastructure.
 */

import { resolve } from "node:path";
import { homedir } from "node:os";
import { existsSync, readFileSync } from "node:fs";

/** @param {{ query: string, scope?: string, type?: string, limit?: number }} args */
export async function toolSearch(args) {
  const { query, scope, type, limit = 10 } = args;

  if (!query?.trim()) {
    return { text: "Error: query is required", isError: true };
  }

  // Try existing EventStore graph search (entities table)
  let searchKeyword, db;
  try {
    const graphMod = await import("../../../../dist/platform/bus/graph-search.js");
    searchKeyword = graphMod.searchKeyword;

    const sqliteMod = await import("../../../../dist/platform/bus/sqlite-adapter.js");
    const dbPath = resolve(process.cwd(), ".claude", "quorum-events.db");
    if (!existsSync(dbPath)) {
      return { text: "No EventStore found. Run `quorum setup` first." };
    }
    db = sqliteMod.openDatabase(dbPath);
  } catch (err) {
    return { text: `Error: ${err.message}`, isError: true };
  }

  try {
    const opts = { limit };
    if (type) opts.type = type;
    if (scope === "project") opts.projectId = process.cwd().replace(/\\/g, "/").split("/").pop();

    const results = searchKeyword(db, query, opts);

    if (results.length === 0) {
      return { text: `No wiki results for "${query}"` };
    }

    const lines = results.map((r, i) => {
      const typeTag = `[${r.type}]`;
      const desc = (r.description || "").slice(0, 200).replace(/\n/g, " ");
      return `${i + 1}. ${typeTag} **${r.title}** — ${desc}`;
    });

    return {
      text: `Found ${results.length} wiki entries for "${query}":\n\n${lines.join("\n")}`,
      json: { count: results.length, results: results.map(r => ({ id: r.id, type: r.type, title: r.title, description: r.description?.slice(0, 500), status: r.status })) },
    };
  } finally {
    try { db.close(); } catch { /* ok */ }
  }
}
