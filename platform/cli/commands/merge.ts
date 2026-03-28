/**
 * quorum merge — squash-merge worktree branch into main.
 *
 * Typically called after retro completes. Automated by hooks,
 * but available as CLI for manual use.
 */

import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { existsSync } from "node:fs";

export async function run(args: string[]): Promise<void> {
  const branch = args[0];
  const force = args.includes("--force");

  if (!branch || branch === "--help" || branch === "-h") {
    console.log(`
\x1b[36mquorum merge\x1b[0m — squash-merge worktree

\x1b[1mUsage:\x1b[0m quorum merge <branch> [--into <target>]

\x1b[1mExamples:\x1b[0m
  quorum merge worktree/impl-TN-1
  quorum merge feature-branch --into main
`);
    return;
  }

  const targetIdx = args.indexOf("--into");
  const target = targetIdx >= 0 ? args[targetIdx + 1] ?? "main" : "main";

  console.log(`\n\x1b[36mquorum merge\x1b[0m ${branch} → ${target}\n`);

  // Parliament enforcement gates (skip with --force)
  if (!force) {
    const dbPath = resolve(process.cwd(), ".claude", "quorum-events.db");
    if (existsSync(dbPath)) {
      try {
        // @ts-expect-error MJS bridge has no type declarations
        const bridge = await import("../../../core/bridge.mjs");
        await bridge.init(process.cwd());
        const gate = bridge.checkParliamentGates();
        if (!gate.allowed) {
          console.log(`  \x1b[31m✗ Parliament gate blocked:\x1b[0m ${gate.reason}`);
          console.log(`  \x1b[2mUse --force to bypass\x1b[0m\n`);
          bridge.close();
          process.exit(1);
        }
        bridge.close();
      } catch { /* fail-open */ }
    }
  }

  // Check if branch exists
  const check = spawnSync("git", ["rev-parse", "--verify", branch], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  if (check.status !== 0) {
    console.log(`  \x1b[31m✗ Branch not found: ${branch}\x1b[0m\n`);
    process.exit(1);
  }

  // Squash merge
  const result = spawnSync("git", ["merge", "--squash", branch], {
    encoding: "utf8",
    stdio: "inherit",
    windowsHide: true,
  });

  if (result.status !== 0) {
    console.log(`\n  \x1b[31m✗ Merge failed. Resolve conflicts and commit manually.\x1b[0m\n`);
    process.exit(1);
  }

  console.log(`\n  \x1b[32m✓ Squash merge complete.\x1b[0m`);
  console.log(`  Review staged changes, then: git commit\n`);
}
