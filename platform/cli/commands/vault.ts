/**
 * quorum vault — vault management commands.
 *
 * Usage:
 *   quorum vault ingest [--auto]    Ingest sessions into vault
 *   quorum vault search <query>     Search vault (FTS)
 *   quorum vault status             Show vault stats
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

function resolveVaultRoot(): string {
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

export async function run(args: string[]): Promise<void> {
  const sub = args[0];

  if (!sub || sub === "status") {
    await showStatus();
  } else if (sub === "ingest") {
    await runIngest(args.slice(1));
  } else if (sub === "search") {
    await runSearch(args.slice(1));
  } else if (sub === "graph") {
    await runGraph();
  } else {
    console.log(`\n\x1b[36mquorum vault\x1b[0m — vault management\n`);
    console.log(`  quorum vault status            Show vault stats`);
    console.log(`  quorum vault ingest [--auto]   Ingest sessions`);
    console.log(`  quorum vault search <query>    Search turns (FTS)`);
    console.log(`  quorum vault graph             Generate graph report\n`);
  }
}

async function showStatus(): Promise<void> {
  const vaultRoot = resolveVaultRoot();
  const dbPath = resolve(vaultRoot, ".store", "vault.db");

  console.log(`\n\x1b[36mquorum vault\x1b[0m — status\n`);
  console.log(`  Root: ${vaultRoot}`);
  console.log(`  DB:   ${existsSync(dbPath) ? dbPath : "(not created)"}`);

  if (!existsSync(dbPath)) {
    console.log(`\n  Run \`quorum vault ingest --auto\` to start.\n`);
    return;
  }

  const { openDatabase } = await import("../../bus/sqlite-adapter.js");
  const { openVaultStore } = await import("../../vault/store.js");
  const store = openVaultStore(vaultRoot, openDatabase);

  try {
    const sessions = store.listSessions();
    const turnCount = store.db.prepare("SELECT COUNT(*) as c FROM turns").get() as { c: number };
    const actionCount = store.db.prepare("SELECT COUNT(*) as c FROM actions").get() as { c: number };
    const embedCount = store.db.prepare("SELECT COUNT(*) as c FROM embeddings").get() as { c: number };

    console.log(`\n  Sessions:   ${sessions.length}`);
    console.log(`  Turns:      ${turnCount.c}`);
    console.log(`  Actions:    ${actionCount.c}`);
    console.log(`  Embeddings: ${embedCount.c}`);

    if (sessions.length > 0) {
      console.log(`\n  Recent sessions:`);
      for (const s of sessions.slice(0, 5)) {
        const date = new Date(s.startedAt).toISOString().slice(0, 10);
        console.log(`    ${s.provider} ${date} — ${s.turnCount} turns (${s.id.slice(0, 12)}...)`);
      }
    }
  } finally {
    store.close();
  }
  console.log();
}

async function runIngest(args: string[]): Promise<void> {
  const vaultRoot = resolveVaultRoot();
  const { openDatabase } = await import("../../bus/sqlite-adapter.js");
  const { openVaultStore } = await import("../../vault/store.js");
  const { ensureVaultStructure } = await import("../../vault/exporter.js");

  ensureVaultStructure(vaultRoot);
  const store = openVaultStore(vaultRoot, openDatabase);

  try {
    if (args.includes("--auto")) {
      const { ingestAuto } = await import("../../vault/ingest.js");
      console.log(`\n\x1b[36m[vault]\x1b[0m Auto-ingesting sessions...\n`);
      const result = ingestAuto(store, vaultRoot);
      console.log(`  Ingested: ${result.ingested}`);
      console.log(`  Skipped:  ${result.skipped} (already indexed)`);
      console.log(`  Errors:   ${result.errors}\n`);
    } else {
      const target = args[0];
      if (!target) {
        console.log(`Usage: quorum vault ingest --auto | <path>`);
        return;
      }
      const { ingestFile, ingestDirectory } = await import("../../vault/ingest.js");
      const result = existsSync(resolve(target))
        ? (target.endsWith(".jsonl") || target.endsWith(".json")
          ? ingestFile(store, resolve(target), vaultRoot)
          : (await import("../../vault/ingest.js")).ingestDirectory(store, resolve(target), vaultRoot))
        : { ingested: 0, skipped: 0, errors: 1, details: [{ file: target, status: "error" as const, error: "not found" }] };

      console.log(`  Ingested: ${result.ingested}, Skipped: ${result.skipped}, Errors: ${result.errors}`);
    }
  } finally {
    store.close();
  }
}

async function runSearch(args: string[]): Promise<void> {
  const query = args.join(" ");
  if (!query.trim()) {
    console.log(`Usage: quorum vault search <query>`);
    return;
  }

  const vaultRoot = resolveVaultRoot();
  const dbPath = resolve(vaultRoot, ".store", "vault.db");
  if (!existsSync(dbPath)) {
    console.log(`No vault database. Run \`quorum vault ingest --auto\` first.`);
    return;
  }

  const { openDatabase } = await import("../../bus/sqlite-adapter.js");
  const { openVaultStore } = await import("../../vault/store.js");
  const store = openVaultStore(vaultRoot, openDatabase);

  try {
    const results = store.searchFTS(query, 10);
    if (results.length === 0) {
      console.log(`No results for "${query}"`);
      return;
    }

    console.log(`\n\x1b[36m[vault]\x1b[0m ${results.length} results for "${query}":\n`);
    for (const r of results) {
      const date = r.timestamp ? new Date(r.timestamp).toISOString().slice(0, 10) : "?";
      const snippet = r.content.slice(0, 150).replace(/\n/g, " ");
      console.log(`  \x1b[2m[${r.provider}]\x1b[0m ${date} (${r.role}) — ${snippet}`);
    }
    console.log();
  } finally {
    store.close();
  }
}

async function runGraph(): Promise<void> {
  const vaultRoot = resolveVaultRoot();

  const eventsDbPath = resolve(process.cwd(), ".claude", "quorum-events.db");
  if (!existsSync(eventsDbPath)) {
    console.log(`No EventStore found. Run \`quorum setup\` first.`);
    return;
  }

  const { openDatabase } = await import("../../bus/sqlite-adapter.js");
  const db = openDatabase(eventsDbPath);

  try {
    const { analyzeGraph, generateGraphReport } = await import("../../vault/graph-analysis.js");

    console.log(`\n\x1b[36m[vault]\x1b[0m Analyzing knowledge graph...\n`);

    const report = analyzeGraph(db);
    console.log(`  Nodes:       ${report.nodeCount}`);
    console.log(`  Edges:       ${report.edgeCount}`);
    console.log(`  Communities: ${report.communities.length}`);
    console.log(`  Hub nodes:   ${report.godNodes.length}`);
    console.log(`  Bridges:     ${report.bridges.length}`);
    console.log(`  Orphans:     ${report.orphans.length}`);

    if (report.godNodes.length > 0) {
      console.log(`\n  Top hub nodes:`);
      for (const n of report.godNodes.slice(0, 5)) {
        console.log(`    \x1b[1m${n.title}\x1b[0m (${n.type}) — ${n.degree} edges`);
      }
    }

    const reportPath = generateGraphReport(db, vaultRoot);
    console.log(`\n  Report: ${reportPath}\n`);
  } finally {
    db.close();
  }
}
