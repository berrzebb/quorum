/**
 * Lifecycle hooks — "what happens after a wave completes?"
 *
 * Wave commit, commit message formatting, retro triggering.
 * Post-track lifecycle: auto-retro and auto-merge.
 * No agent spawning, no execution logic.
 */

import { existsSync, rmSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { pathToFileURL, fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Determine if auto-retro should trigger after a wave result.
 * Currently triggers on any completed wave (pass or fail).
 */
export function shouldTriggerRetro(waveResult: { passed: boolean }): boolean {
  // Retro is always triggered at track completion, not per-wave.
  // Per-wave retro is opt-in (return true only for specific conditions).
  return waveResult.passed;
}

/**
 * Build a standardized WIP commit message for a wave.
 */
export function buildWaveCommitMessage(
  trackName: string, waveIndex: number, files: string[],
): string {
  return `WIP(${trackName}/wave-${waveIndex}): ${files.length} files`;
}

/**
 * WIP commit after wave implementation completes.
 * Protects completed work from being lost by subsequent waves.
 *
 * @returns true if commit was created, false if nothing to commit
 */
export function waveCommit(
  repoRoot: string, files: string[], waveNum: number, trackName: string,
): boolean {

  try {
    const existingFiles = files.filter(f => {
      try {
        const p = f.startsWith("/") || f.includes(":\\") ? f : resolve(repoRoot, f);
        return existsSync(p);
      } catch { return false; }
    });
    if (existingFiles.length === 0) return false;

    execFileSync("git", ["add", ...existingFiles], {
      cwd: repoRoot, windowsHide: true, stdio: "pipe",
    });

    const staged = execFileSync("git", ["diff", "--cached", "--name-only"], {
      cwd: repoRoot, encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (!staged) return false;

    const msg = buildWaveCommitMessage(trackName, waveNum, staged.split("\n"));
    execFileSync("git", ["commit", "-m", msg], {
      cwd: repoRoot, encoding: "utf8", windowsHide: true, stdio: "pipe",
    });
    return true;
  } catch { return false; }
}

/**
 * Amend the latest WIP commit with updated RTM status.
 * Called after audit to squash RTM "implemented" → "passed"/"failed" into the same commit.
 */
export function amendWaveCommit(repoRoot: string, rtmPath: string): void {
  try {
    execFileSync("git", ["add", rtmPath], { cwd: repoRoot, windowsHide: true, stdio: "pipe" });
    execFileSync("git", ["commit", "--amend", "--no-edit"], {
      cwd: repoRoot, encoding: "utf8", windowsHide: true, stdio: "pipe",
    });
  } catch { /* fail-open: amend is best-effort */ }
}

// ── Post-track lifecycle ────────────────────

type Bridge = Record<string, Function>;

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
    // dist/platform/orchestrate/governance/ → up 4 → quorum project root
    const quorumRoot = resolve(__dirname, "..", "..", "..", "..");
    const bridge = await import(toURL(resolve(quorumRoot, "platform", "core", "bridge.mjs")));
    if (bridge?.emitEvent) {
      bridge.emitEvent("retro.complete", "generic", { auto: true, timestamp: Date.now() });
    }
  } catch { /* non-critical */ }
}

/** Squash-merge if in worktree, with parliament gate check. */
export async function autoMerge(repoRoot: string, bridge: Bridge | null): Promise<void> {
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
