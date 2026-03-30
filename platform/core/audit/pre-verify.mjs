/* global process */

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { REPO_ROOT } from "../context.mjs";
import { extractChangedFilesFromEvidence, extractTestCommands } from "./scope.mjs";

// Blast radius — fail-safe top-level import (non-critical)
let _computeBlastRadius = null;
try {
  const tc = await import("../tools/tool-core.mjs");
  _computeBlastRadius = tc.computeBlastRadius;
} catch { /* tool-core unavailable — blast radius skipped */ }

/**
 * Run all deterministic verifications LOCALLY before invoking the auditor.
 *
 * The auditor receives pre-computed results instead of running commands
 * in its own sandbox (which may have stale state).
 *
 * Returns a markdown section with:
 *   - Changed files (from git)
 *   - CQ-1: eslint results per changed file
 *   - CQ-2: tsc --noEmit results
 *   - T: test command results (from evidence)
 */
export function runPreVerification(markdown, cwd) {
  const root = cwd || REPO_ROOT;
  const sections = [];

  // 1. Changed files (CC-2)
  sections.push(computeChangedFiles(markdown, root));

  // 2. CQ-2: tsc --noEmit (root + web if exists)
  sections.push(runTscLocally(root));

  // 3. CQ-1: eslint on changed source files
  const changedFiles = extractChangedFilesFromEvidence(markdown);
  sections.push(runEslintLocally(changedFiles, root));

  // 4. T: re-run test commands from evidence
  const testCmds = extractTestCommands(markdown);
  sections.push(runTestsLocally(testCmds, root));

  // 5. Blast radius — transitive impact of changed files
  if (changedFiles.length > 0) {
    sections.push(computeBlastRadiusSection(changedFiles, root));
  }

  return sections.join("\n\n");
}

/** Run tsc --noEmit locally and return results. */
export function runTscLocally(root) {
  const results = ["### CQ-2: TypeScript Check (pre-verified locally)"];
  if (!existsSync(resolve(root, "tsconfig.json"))) return results.join("\n");

  const rootTsc = spawnSync("npx", ["tsc", "--noEmit"], {
    cwd: root, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], timeout: 60000, shell: process.platform === "win32" ? process.env.COMSPEC || "cmd.exe" : true, windowsHide: true,
  });
  results.push(`**Root \`npx tsc --noEmit\`**: ${rootTsc.status === 0 ? "\u2705 0 errors" : "\u274C FAILED"}`);
  if (rootTsc.status !== 0) {
    const output = (rootTsc.stdout || rootTsc.stderr || "").trim();
    if (output) results.push("```\n" + output.slice(0, 1000) + "\n```");
  }

  const webTsconfig = resolve(root, "web", "tsconfig.json");
  if (existsSync(webTsconfig)) {
    const webTsc = spawnSync("npx", ["tsc", "--noEmit", "-p", "web/tsconfig.json"], {
      cwd: root, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], timeout: 60000, shell: process.platform === "win32" ? process.env.COMSPEC || "cmd.exe" : true, windowsHide: true,
    });
    results.push(`**Web \`npx tsc --noEmit -p web/tsconfig.json\`**: ${webTsc.status === 0 ? "\u2705 0 errors" : "\u274C FAILED"}`);
    if (webTsc.status !== 0) {
      const output = (webTsc.stdout || webTsc.stderr || "").trim();
      if (output) results.push("```\n" + output.slice(0, 1000) + "\n```");
    }
  }

  return results.join("\n");
}

/** Run eslint on changed source files locally. */
export function runEslintLocally(files, root) {
  const sourceFiles = files.filter(f => f.match(/\.(ts|tsx|js|jsx|mjs)$/));
  if (sourceFiles.length === 0) {
    return "### CQ-1: ESLint (pre-verified locally)\nNo source files to lint.";
  }

  const results = ["### CQ-1: ESLint (pre-verified locally)"];
  let allPassed = true;

  for (const file of sourceFiles) {
    const fullPath = resolve(root, file);
    if (!existsSync(fullPath)) continue;

    const lint = spawnSync("npx", ["eslint", file, "--no-warn-ignored"], {
      cwd: root, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], timeout: 30000, shell: process.platform === "win32" ? process.env.COMSPEC || "cmd.exe" : true, windowsHide: true,
    });
    if (lint.status !== 0) {
      allPassed = false;
      const output = (lint.stdout || lint.stderr || "").trim();
      results.push(`- \u274C \`${file}\`: ${output.split("\n")[0]}`);
    }
  }

  if (allPassed) {
    results.push(`\u2705 All ${sourceFiles.length} files pass eslint.`);
  }

  return results.join("\n");
}

/** Run test commands from evidence locally. */
export function runTestsLocally(cmds, root) {
  if (cmds.length === 0) {
    return "### T-1: Tests (pre-verified locally)\nNo test commands found in evidence.";
  }

  const results = ["### T-1: Tests (pre-verified locally)"];

  for (const cmd of cmds) {
    if (cmd.includes("eslint") || cmd.includes("tsc")) continue;

    const parts = cmd.split(/\s+/);
    const child = spawnSync(parts[0], parts.slice(1), {
      cwd: root, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
      timeout: 120000, shell: process.platform === "win32" ? process.env.COMSPEC || "cmd.exe" : true, windowsHide: true,
    });

    const passed = child.status === 0;
    const output = (child.stdout || child.stderr || "").trim();
    results.push(`**\`${cmd}\`**: ${passed ? "\u2705 PASS" : "\u274C FAIL"}`);
    if (!passed) {
      results.push("```\n" + output.slice(-500) + "\n```");
    } else {
      // Extract summary line (last few lines usually have counts)
      const lines = output.split("\n");
      const summary = lines.slice(-3).join("\n");
      results.push("```\n" + summary + "\n```");
    }
  }

  return results.join("\n");
}

/** Compute changed file list for CC-2. */
export function computeChangedFiles(markdown, root) {
  const cwd = root || REPO_ROOT;
  let diffCmd = "git diff --name-only";

  // 1. Extract from evidence — look for explicit diff basis (hash..hash or hash..HEAD)
  const diffBasisRe = /git\s+diff\s+(?:--name-only\s+)?([0-9a-f]{7,40}\.{2,3}(?:[0-9a-f]{7,40}|HEAD))/;
  const match = markdown.match(diffBasisRe);
  if (match) {
    diffCmd = `git diff --name-only ${match[1]}`;
  } else {
    // 2. Compute from git history
    let useMergeBase = false;
    try {
      const mainBranch = (() => {
        const r = spawnSync("git", ["rev-parse", "--verify", "main"], { cwd, stdio: "pipe", windowsHide: true });
        return r.status === 0 ? "main" : "master";
      })();
      const mergeBase = spawnSync("git", ["merge-base", "HEAD", mainBranch], {
        cwd, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], windowsHide: true,
      });
      if (mergeBase.status === 0 && mergeBase.stdout.trim()) {
        const base = mergeBase.stdout.trim().slice(0, 10);
        const testCmd = `git diff --name-only ${base}..HEAD`;
        const testResult = spawnSync("git", ["diff", "--name-only", `${base}..HEAD`], {
          cwd, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], windowsHide: true,
        });
        const testFiles = (testResult.stdout || "").trim().split("\n").filter(Boolean);
        if (testFiles.length > 0) {
          diffCmd = testCmd;
          useMergeBase = true;
        }
      }
    } catch { /* merge-base failed */ }

    if (!useMergeBase) {
      try {
        const log = spawnSync("git", ["log", "--oneline", "-10", "--format=%H"], {
          cwd, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], windowsHide: true,
        });
        if (log.status === 0) {
          const hashes = log.stdout.trim().split("\n").filter(Boolean);
          if (hashes.length > 1) {
            const oldest = hashes[hashes.length - 1].slice(0, 10);
            diffCmd = `git diff --name-only ${oldest}..HEAD`;
          }
        }
      } catch { /* fallback failed */ }
    }
  }

  const result = spawnSync("git", diffCmd.replace("git ", "").split(" "), {
    cwd, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], windowsHide: true,
  });

  let files = (result.status === 0 ? result.stdout : "").trim().split("\n").filter(Boolean);

  // Fallback: staged new files (first commit in worktree — no unstaged diff, no merge-base)
  if (files.length === 0) {
    const staged = spawnSync("git", ["diff", "--cached", "--name-only"], {
      cwd, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], windowsHide: true,
    });
    const stagedFiles = (staged.status === 0 ? staged.stdout : "").trim().split("\n").filter(Boolean);
    if (stagedFiles.length > 0) {
      diffCmd = "git diff --cached --name-only";
      files = stagedFiles;
    }
  }

  const fileList = files.length > 0
    ? files.map(f => `- \`${f}\``).join("\n")
    : "(no changed files detected)";

  return `**Diff scope** (\`${diffCmd}\`, ${files.length} files):\n${fileList}`;
}

/** Compute blast radius section for pre-verification evidence. */
function computeBlastRadiusSection(changedFiles, root) {
  const lines = ["### Blast Radius (pre-verified locally)"];
  try {
    if (!_computeBlastRadius) {
      lines.push("_blast radius unavailable — skipped_");
      return lines.join("\n");
    }

    const absFiles = changedFiles.map(f => resolve(root, f));
    const result = _computeBlastRadius(root, absFiles);

    if (result.error) {
      lines.push(`_graph build failed: ${result.error}_`);
      return lines.join("\n");
    }

    if (result.affected === 0) {
      lines.push(`_0/${changedFiles.length} changed files found in dependency graph — skipped_`);
      return lines.join("\n");
    }

    lines.push(`**Impact**: ${result.affected} / ${result.total} files affected (${(result.ratio * 100).toFixed(1)}%)`);
    const display = result.files.slice(0, 20);
    for (const f of display) {
      lines.push(`- \`${f.file}\` (depth ${f.depth})`);
    }
    if (result.files.length > 20) {
      lines.push(`- _...and ${result.files.length - 20} more files_`);
    }
  } catch {
    lines.push("_blast radius computation failed — skipped_");
  }
  return lines.join("\n");
}
