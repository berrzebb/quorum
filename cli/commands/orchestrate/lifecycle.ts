/**
 * Post-track lifecycle — auto-retro and auto-merge.
 *
 * Called after all WBs in a track are approved.
 */

import { existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { Bridge } from "./shared.js";

/** Clear retro marker and release session gate. */
export async function autoRetro(repoRoot: string): Promise<void> {
  const markerPath = resolve(repoRoot, ".session-state", "retro-marker.json");

  if (existsSync(markerPath)) {
    try {
      rmSync(markerPath);
      console.log("  \x1b[32m✓ Retro marker cleared — session gate released.\x1b[0m");
    } catch (err) {
      console.log(`  \x1b[33m⚠ Could not clear retro marker: ${(err as Error).message}\x1b[0m`);
    }
  } else {
    console.log("  \x1b[2mNo retro marker (gate already open).\x1b[0m");
  }

  try {
    const toURL = (p: string) => pathToFileURL(p).href;
    const bridge = await import(toURL(resolve(repoRoot, "core", "bridge.mjs")));
    if (bridge?.emitEvent) {
      bridge.emitEvent("retro.complete", "generic", { auto: true, timestamp: Date.now() });
    }
  } catch { /* non-critical */ }
}

/** Squash-merge if in worktree, with parliament gate check. */
export async function autoMerge(repoRoot: string, bridge: Bridge | null): Promise<void> {
  const { spawnSync } = await import("node:child_process");

  const gitDir = spawnSync("git", ["rev-parse", "--git-dir"], {
    cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true,
  });

  const isWorktree = gitDir.stdout?.includes("/worktrees/") || gitDir.stdout?.includes("\\worktrees\\");

  if (!isWorktree) {
    console.log("  \x1b[2mNot in worktree — skip auto-merge.\x1b[0m\n");
    return;
  }

  const branchResult = spawnSync("git", ["branch", "--show-current"], {
    cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true,
  });
  const branch = branchResult.stdout?.trim();

  if (!branch) {
    console.log("  \x1b[33m⚠ Could not detect branch.\x1b[0m\n");
    return;
  }

  if (bridge?.checkParliamentGates) {
    const gate = bridge.checkParliamentGates();
    if (!gate.allowed) {
      console.log(`  \x1b[33m⚠ Merge blocked: ${gate.reason}\x1b[0m\n`);
      return;
    }
  }

  console.log(`  \x1b[36mAuto-merge: ${branch} → main\x1b[0m`);
  const merge = spawnSync("git", ["merge", "--squash", branch], {
    cwd: repoRoot, encoding: "utf8", stdio: "inherit", windowsHide: true,
  });

  if (merge.status === 0) {
    console.log("  \x1b[32m✓ Squash merge staged.\x1b[0m\n");
  } else {
    console.log("  \x1b[33m⚠ Merge had issues.\x1b[0m\n");
  }
}
