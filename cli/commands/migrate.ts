/**
 * quorum migrate — import consensus-loop data into quorum.
 *
 * 1. Copy config: .claude/consensus-loop/config.json → .claude/quorum/config.json
 * 2. Import audit history: .claude/audit-history.jsonl → SQLite EventStore
 * 3. Migrate session state: .session-state/ retro markers
 * 4. Preserve watch/respond files (no move needed)
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST = resolve(__dirname, "..", "..");

export async function run(args: string[]): Promise<void> {
  const repoRoot = process.cwd();
  const dryRun = args.includes("--dry-run");
  const steps: { label: string; status: "done" | "skip" | "error"; detail?: string }[] = [];

  console.log(`\n\x1b[36mquorum migrate\x1b[0m — import consensus-loop data${dryRun ? " (dry run)" : ""}\n`);

  // 1. Config migration
  const oldConfigDir = resolve(repoRoot, ".claude", "consensus-loop");
  const newConfigDir = resolve(repoRoot, ".claude", "quorum");
  const oldConfig = resolve(oldConfigDir, "config.json");
  const newConfig = resolve(newConfigDir, "config.json");

  if (existsSync(oldConfig) && !existsSync(newConfig)) {
    if (!dryRun) {
      mkdirSync(newConfigDir, { recursive: true });
      copyFileSync(oldConfig, newConfig);
    }
    steps.push({ label: "Config migrated", status: "done", detail: `${oldConfig} → ${newConfig}` });
  } else if (existsSync(newConfig)) {
    steps.push({ label: "Config", status: "skip", detail: "quorum config already exists" });
  } else if (!existsSync(oldConfig)) {
    steps.push({ label: "Config", status: "skip", detail: "no consensus-loop config found" });
  }

  // 2. Audit history → SQLite EventStore
  const historyPath = resolve(repoRoot, ".claude", "audit-history.jsonl");
  const dbPath = resolve(repoRoot, ".claude", "quorum-events.db");

  if (existsSync(historyPath)) {
    const lines = readFileSync(historyPath, "utf8").trim().split("\n").filter(Boolean);
    let imported = 0;

    if (!dryRun && lines.length > 0) {
      try {
        const toURL = (p: string) => pathToFileURL(p).href;
        const { EventStore } = await import(toURL(resolve(DIST, "bus", "store.js")));
        const store = new EventStore({ dbPath });

        for (const line of lines) {
          try {
            const entry = JSON.parse(line);
            store.append({
              type: "audit.verdict",
              source: "codex",
              timestamp: new Date(entry.timestamp).getTime(),
              sessionId: entry.session_id ?? undefined,
              payload: {
                verdict: entry.verdict === "agree" ? "approved" : "changes_requested",
                codes: entry.rejection_codes ?? [],
                track: entry.track ?? "",
                reqIds: entry.req_ids ?? [],
                agreedCount: entry.agreed_count ?? 0,
                pendingCount: entry.pending_count ?? 0,
                durationMs: entry.duration_ms ?? 0,
                migratedFrom: "consensus-loop",
              },
            });
            imported++;
          } catch {
            // skip malformed lines
          }
        }

        store.close();
      } catch (err) {
        steps.push({ label: "Audit history", status: "error", detail: `Import failed: ${(err as Error).message}` });
      }
    }

    if (!steps.some((s) => s.label === "Audit history")) {
      steps.push({
        label: "Audit history",
        status: "done",
        detail: dryRun
          ? `${lines.length} entries found (would import)`
          : `${imported}/${lines.length} entries imported to SQLite`,
      });
    }
  } else {
    steps.push({ label: "Audit history", status: "skip", detail: "no audit-history.jsonl found" });
  }

  // 3. Session state (retro markers)
  const oldSessionState = resolve(repoRoot, ".session-state", "retro-marker.json");
  if (existsSync(oldSessionState)) {
    steps.push({ label: "Session state", status: "done", detail: "retro-marker.json preserved (shared location)" });
  } else {
    steps.push({ label: "Session state", status: "skip", detail: "no active retro marker" });
  }

  // 4. Watch/respond files
  let watchFile = "docs/feedback/claude.md";
  try {
    const cfg = JSON.parse(readFileSync(existsSync(newConfig) ? newConfig : oldConfig, "utf8"));
    watchFile = cfg.consensus?.watch_file ?? watchFile;
  } catch { /* use default */ }

  const watchPath = resolve(repoRoot, watchFile);
  if (existsSync(watchPath)) {
    steps.push({ label: "Watch file", status: "done", detail: `${watchFile} (no migration needed)` });
  } else {
    steps.push({ label: "Watch file", status: "skip", detail: `${watchFile} not found` });
  }

  // 5. MCP server registration
  const mcpPath = resolve(repoRoot, ".mcp.json");
  if (existsSync(mcpPath)) {
    try {
      const mcp = JSON.parse(readFileSync(mcpPath, "utf8"));
      const servers = mcp.mcpServers ?? {};
      if (servers["consensus-loop"] && !servers.quorum) {
        if (!dryRun) {
          servers.quorum = { ...servers["consensus-loop"] };
          mcp.mcpServers = servers;
          writeFileSync(mcpPath, JSON.stringify(mcp, null, 2) + "\n");
        }
        steps.push({ label: "MCP server", status: "done", detail: "consensus-loop entry cloned as quorum" });
      } else if (servers.quorum) {
        steps.push({ label: "MCP server", status: "skip", detail: "quorum already registered" });
      } else {
        steps.push({ label: "MCP server", status: "skip", detail: "no consensus-loop MCP entry" });
      }
    } catch {
      steps.push({ label: "MCP server", status: "skip", detail: ".mcp.json parse error" });
    }
  }

  // Summary
  console.log("  Steps:");
  for (const step of steps) {
    const icon = step.status === "done" ? "\x1b[32m✓\x1b[0m" : step.status === "skip" ? "\x1b[2m–\x1b[0m" : "\x1b[31m✗\x1b[0m";
    console.log(`  ${icon} ${step.label}: ${step.detail ?? ""}`);
  }

  const doneCount = steps.filter((s) => s.status === "done").length;
  if (doneCount > 0) {
    console.log(`\n\x1b[32mMigration complete.\x1b[0m ${doneCount} item(s) migrated.`);
  } else {
    console.log(`\n\x1b[2mNothing to migrate.\x1b[0m`);
  }

  console.log(`\nNext: quorum status\n`);
}
