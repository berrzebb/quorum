/**
 * recall — MCP tool for searching past AI agent sessions.
 *
 * Hybrid BM25 + vector search via vault.db.
 * Falls back to keyword-only if embeddings unavailable.
 */

import { resolve } from "node:path";
import { homedir } from "node:os";
import { existsSync, readFileSync } from "node:fs";

/** @param {{ query: string, mode?: string, provider?: string, limit?: number }} args */
export async function toolRecall(args) {
  const { query, mode = "keyword", provider, limit = 10 } = args;

  if (!query?.trim()) {
    return { text: "Error: query is required", isError: true };
  }

  // Resolve vault root
  const vaultRoot = resolveVaultRoot();

  // Dynamic imports (compiled TS → dist/)
  let openVaultStore, openDatabase, searchHybrid;
  try {
    const storeMod = await import("../../../../dist/platform/vault/store.js");
    openVaultStore = storeMod.openVaultStore;
    const sqliteMod = await import("../../../../dist/platform/bus/sqlite-adapter.js");
    openDatabase = sqliteMod.openDatabase;
    const searchMod = await import("../../../../dist/platform/vault/search.js");
    searchHybrid = searchMod.searchHybrid;
  } catch (err) {
    return { text: `Error: vault modules not available — run \`npm run build\`. ${err.message}`, isError: true };
  }

  const dbPath = resolve(vaultRoot, ".store", "vault.db");
  if (!existsSync(dbPath)) {
    return { text: `No vault database found. Run \`quorum vault ingest --auto\` first.`, isError: true };
  }

  let store;
  try {
    store = openVaultStore(vaultRoot, openDatabase);
  } catch (err) {
    return { text: `Error opening vault: ${err.message}`, isError: true };
  }

  try {
    // For now, keyword search always works. Semantic/hybrid requires embeddings.
    const results = await searchHybrid(store, query, null /* embedder */, {
      mode: mode === "hybrid" && !hasEmbeddings(store) ? "keyword" : mode,
      provider,
      limit,
    });

    if (results.length === 0) {
      return { text: `No results for "${query}"` };
    }

    const lines = results.map((r, i) => {
      const date = r.timestamp ? new Date(r.timestamp).toISOString().slice(0, 10) : "?";
      const snippet = r.content.slice(0, 200).replace(/\n/g, " ");
      return `${i + 1}. [${r.provider}] ${date} (${r.role}) — ${snippet}`;
    });

    return {
      text: `Found ${results.length} results for "${query}":\n\n${lines.join("\n")}`,
      json: { count: results.length, results: results.map(r => ({ turnId: r.turnId, sessionId: r.sessionId, provider: r.provider, role: r.role, content: r.content.slice(0, 500), score: r.rrfScore ?? r.score, timestamp: r.timestamp })) },
    };
  } finally {
    store.close();
  }
}

function resolveVaultRoot() {
  // Priority: config → env → default
  try {
    const configPath = resolve(process.cwd(), ".claude", "quorum", "config.json");
    if (existsSync(configPath)) {
      const config = JSON.parse(readFileSync(configPath, "utf8"));
      if (config.vaultPath) return config.vaultPath;
    }
  } catch { /* use default */ }

  if (process.env.QUORUM_VAULT_PATH) return process.env.QUORUM_VAULT_PATH;
  return resolve(homedir(), ".quorum", "vault");
}

function hasEmbeddings(store) {
  try {
    const row = store.db.prepare("SELECT COUNT(*) as c FROM embeddings").get();
    return row?.c > 0;
  } catch { return false; }
}
