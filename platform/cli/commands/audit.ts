/**
 * quorum audit — trigger manual audit.
 *
 * SQLite-based: reads pending evidence from EventStore,
 * triggers audit via bridge, stores verdict in EventStore.
 * Falls back to watch-file detection if no EventStore pending items.
 */

import { existsSync, readFileSync } from "node:fs";  // readFileSync: config only
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Resolve quorum package root (not target project root)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
/** At runtime: dist/platform/cli/commands/ → up 3 → dist/ (project root = DIST/..) */
const DIST = resolve(__dirname, "..", "..", "..");

export async function run(args: string[]): Promise<void> {
  const repoRoot = process.cwd();

  if (args[0] === "history") {
    const quorumBase = resolve(DIST, "..");
    const toolRunner = resolve(quorumBase, "platform", "core", "tools", "tool-runner.mjs");
    const historyPath = resolve(repoRoot, ".claude", "audit-history.jsonl");
    const { spawnSync } = await import("node:child_process");
    const result = spawnSync(process.execPath, [toolRunner, "audit_history", "--path", historyPath, ...args.slice(1)], {
      stdio: "inherit",
      cwd: repoRoot,
      windowsHide: true,
    });
    process.exit(result.status ?? 0);
    return;
  }

  console.log("\n\x1b[36mquorum audit\x1b[0m — manual audit trigger\n");

  // Load config
  const configPath = resolve(repoRoot, ".claude", "quorum", "config.json");
  let triggerTag = "[REVIEW_NEEDED]";
  if (existsSync(configPath)) {
    try {
      const cfg = JSON.parse(readFileSync(configPath, "utf8"));
      triggerTag = cfg.consensus?.trigger_tag ?? triggerTag;
    } catch (err) { console.warn(`[audit] config parse failed: ${(err as Error).message}`); }
  }

  // Try bridge-based audit (SQLite EventStore)
  const quorumRoot = resolve(DIST, "..");
  const toURL = (p: string) => pathToFileURL(p).href;
  /** Resolve a module path checking platform/ first, then root fallback. */
  const resolveMod = (...segments: string[]): string => {
    const platformPath = resolve(quorumRoot, "platform", ...segments);
    if (existsSync(platformPath)) return platformPath;
    return resolve(quorumRoot, ...segments);
  };
  let bridge: any = null;
  try {
    bridge = await import(toURL(resolveMod("core", "bridge.mjs")));
    if (!bridge._store) await bridge.init(repoRoot);
  } catch (err) {
    console.warn(`[audit] bridge init failed: ${(err as Error).message}`);
    bridge = null;
  }

  if (bridge) {
    // Check for pending items via EventStore (SQLite-only, no md file)
    const events = bridge.event?.queryEvents?.({ eventType: "audit.submit" }) ?? [];
    const verdicts = bridge.event?.queryEvents?.({ eventType: "audit.verdict" }) ?? [];
    const pendingCount = events.length - verdicts.length;

    // Check KV for latest evidence
    const latestEvidence = bridge.query?.getLatestEvidence?.();
    const hasEvidence = pendingCount > 0 || !!latestEvidence?.content;

    if (!hasEvidence) {
      console.log("  \x1b[32m✓ No pending items to audit\x1b[0m\n");
      if (bridge.close) bridge.close();
      return;
    }

    console.log(`  Pending: ${Math.max(pendingCount, 0)} event(s)${latestEvidence ? " + stored evidence" : ""}`);
    console.log("  Triggering audit via bridge...\n");

    // Use bridge to run audit
    try {
      const auditScript = resolveMod("core", "audit", "index.mjs");
      if (existsSync(auditScript)) {
        const { spawnSync } = await import("node:child_process");
        const parliament = args.includes("--parliament");
        const result = spawnSync(process.execPath, [auditScript], {
          stdio: "inherit",
          cwd: repoRoot,
          env: {
            ...process.env,
            FEEDBACK_HOOK_DRY_RUN: args.includes("--dry-run") ? "1" : "",
            QUORUM_PARLIAMENT: parliament ? "1" : "",
          },
          windowsHide: true,
        });
        if (result.status === 0) {
          console.log("\n  \x1b[32m✓ Audit complete\x1b[0m");
        } else {
          console.log(`\n  \x1b[31m✗ Audit exited with code ${result.status}\x1b[0m`);
        }
      } else {
        console.log("  \x1b[31m✗ Audit module not found\x1b[0m");
      }
    } catch (err) {
      console.error(`  \x1b[31m✗ ${(err as Error).message}\x1b[0m`);
    }

    if (bridge.close) bridge.close();
  } else {
    // Fallback: no bridge — use audit-status.json marker
    const statusPath = resolve(repoRoot, ".claude", "audit-status.json");
    let hasPending = false;
    try {
      const status = JSON.parse(readFileSync(statusPath, "utf8"));
      hasPending = status.status === "changes_requested" || status.status === "submitted";
    } catch (err) { console.warn(`[audit] audit-status.json read failed: ${(err as Error).message}`); }

    if (!hasPending) {
      console.log("  \x1b[32m✓ No pending items to audit\x1b[0m\n");
      return;
    }

    console.log("  \x1b[33m⚠ Bridge unavailable, falling back to legacy audit\x1b[0m");
    const auditScript = resolveMod("core", "audit", "index.mjs");
    if (!existsSync(auditScript)) {
      console.log("  \x1b[31m✗ core/audit/index.mjs not found\x1b[0m\n");
      return;
    }

    const { spawnSync } = await import("node:child_process");
    const result = spawnSync(process.execPath, [auditScript], {
      stdio: "inherit",
      cwd: repoRoot,
      env: { ...process.env, FEEDBACK_HOOK_DRY_RUN: args.includes("--dry-run") ? "1" : "" },
      windowsHide: true,
    });

    if (result.status === 0) {
      console.log("\n  \x1b[32m✓ Audit complete\x1b[0m");
    } else {
      console.log(`\n  \x1b[31m✗ Audit exited with code ${result.status}\x1b[0m`);
    }
  }

  console.log();
}
