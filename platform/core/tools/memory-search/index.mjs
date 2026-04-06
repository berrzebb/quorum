/**
 * memory_search — Unified knowledge graph search (v0.6.5 DCM FR-6).
 *
 * 3 modes: keyword (FTS5), semantic (sqlite-vec), graph (edge traversal).
 * MCP tool — all models access same knowledge through same interface.
 */

let _search = null;
let _query = null;

async function mods() {
  if (!_search) _search = await import("../../../dist/platform/bus/graph-search.js");
  if (!_query) _query = await import("../../../dist/platform/bus/graph-query.js");
  return { search: _search, query: _query };
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
export async function toolMemorySearch(args) {
  const { query, mode = "keyword", scope, type, limit = 10, direction } = args;
  if (!query) return { error: "query is required" };

  const db = await getDb();
  if (!db) return { text: "(graph database unavailable)" };

  const { search, query: gq } = await mods();

  try {
    // ── Graph traversal mode ──
    if (mode === "graph") {
      if (direction === "rtm") {
        const trace = gq.traceRTM(db, query);
        if (!trace) return { text: `No RTM trace for "${query}"` };
        const lines = [`FR: ${trace.fr.title}`];
        if (trace.files.length) lines.push(`Files: ${trace.files.map(f => f.title).join(", ")}`);
        if (trace.tests.length) lines.push(`Tests: ${trace.tests.map(t => t.title).join(", ")}`);
        return { text: lines.join("\n"), summary: `RTM: ${trace.files.length} files, ${trace.tests.length} tests` };
      }
      const fn = direction === "reverse" ? gq.queryReverse : gq.queryForward;
      const results = fn(db, query, { limit });
      return formatResults(results, `${direction ?? "forward"} from "${query}"`);
    }

    // ── Keyword mode (default) ──
    const projectId = scope === "global" ? undefined : projectName();
    const results = search.searchKeyword(db, query, { type, projectId, limit });
    return formatResults(results, `keyword "${query}"`);

  } catch (err) {
    return { error: `memory_search: ${err.message}` };
  }
}

function formatResults(results, ctx) {
  if (!results.length) return { text: `No results (${ctx})`, summary: "0 results" };
  const lines = results.map(e => {
    const desc = e.description ? " — " + (e.description.length > 120 ? e.description.slice(0, 117) + "..." : e.description) : "";
    return `${e.type}: ${e.title}${desc}`;
  });
  return { text: lines.join("\n"), summary: `${results.length} result(s)` };
}

function projectName() {
  try { return require("node:path").basename(process.cwd()); } catch { return undefined; }
}
