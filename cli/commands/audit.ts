/**
 * quorum audit — trigger manual audit.
 *
 * Reads the watch file and triggers an audit cycle if evidence exists.
 * Can also show audit history.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

export async function run(args: string[]): Promise<void> {
  const repoRoot = process.cwd();

  if (args[0] === "history") {
    // Delegate to audit_history tool
    const toolRunner = resolve(repoRoot, "core", "tools", "tool-runner.mjs");
    const historyPath = resolve(repoRoot, ".claude", "audit-history.jsonl");
    const result = spawnSync(process.execPath, [toolRunner, "audit_history", "--path", historyPath, ...args.slice(1)], {
      stdio: "inherit",
      cwd: repoRoot,
      windowsHide: true,
    });
    process.exit(result.status ?? 0);
    return;
  }

  console.log("\n\x1b[36mquorum audit\x1b[0m — manual audit trigger\n");

  // Check watch file
  const configPath = resolve(repoRoot, ".claude", "quorum", "config.json");
  let watchFile = "docs/feedback/claude.md";
  let triggerTag = "[REVIEW_NEEDED]";
  if (existsSync(configPath)) {
    try {
      const cfg = JSON.parse(readFileSync(configPath, "utf8"));
      watchFile = cfg.consensus?.watch_file ?? watchFile;
      triggerTag = cfg.consensus?.trigger_tag ?? triggerTag;
    } catch { /* use default */ }
  }

  const watchPath = resolve(repoRoot, watchFile);
  if (!existsSync(watchPath)) {
    console.log(`  \x1b[31m✗ Watch file not found: ${watchFile}\x1b[0m`);
    console.log("  Run 'quorum setup' first\n");
    return;
  }

  const content = readFileSync(watchPath, "utf8");
  if (!content.includes(triggerTag)) {
    console.log("  \x1b[32m✓ No pending items to audit\x1b[0m\n");
    return;
  }

  // Trigger audit via core module
  console.log("  Triggering audit...");
  const auditScript = resolve(repoRoot, "core", "audit.mjs");
  if (!existsSync(auditScript)) {
    console.log("  \x1b[31m✗ core/audit.mjs not found\x1b[0m\n");
    return;
  }

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
  console.log();
}
