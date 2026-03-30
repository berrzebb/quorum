/**
 * Pre-flight validation — checks project state before orchestration.
 *
 * Pure validation. No implementation execution, no wave scheduling.
 * Checks: git status, build health, test pass, fitness baseline.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve, sep } from "node:path";
import { execSync } from "node:child_process";
import {
  collectFitnessSignals,
  computeFitness,
} from "../governance/fitness-gates.js";
import { runProjectTests } from "../governance/scope-gates.js";

// ── Types ────────────────────────────────────

export interface PreflightResult {
  errors: string[];
  warnings: string[];
  fitnessBaseline?: number;
}

// ── Helpers ──────────────────────────────────

/** Walk a directory tree collecting source files matching a filter. */
export function walkSourceFiles(
  dir: string, filter: (name: string) => boolean, maxDepth = 8, depth = 0,
): string[] {
  if (depth > maxDepth) return [];
  const results: string[] = [];
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist") continue;
      const full = resolve(dir, entry.name);
      if (entry.isDirectory()) results.push(...walkSourceFiles(full, filter, maxDepth, depth + 1));
      else if (filter(entry.name)) results.push(full);
    }
  } catch (err) { console.warn(`[preflight] walkSourceFiles access error in ${dir}: ${(err as Error).message}`); }
  return results;
}

// ── Main ─────────────────────────────────────

/**
 * Validate project state before starting orchestration.
 * Checks: clean working tree, project builds, tests pass, fitness baseline.
 */
export function runPreflightCheck(repoRoot: string): PreflightResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  let fitnessBaseline: number | undefined;

  // 1. Check for uncommitted changes
  try {
    const status = execSync("git status --porcelain", { cwd: repoRoot, timeout: 10_000, encoding: "utf8", stdio: "pipe", windowsHide: true }).trim();
    if (status) {
      const lines = status.split("\n").length;
      warnings.push(`${lines} uncommitted change(s) — consider committing before orchestrate`);
    }
  } catch (err) { console.warn(`[preflight] git status check skipped: ${(err as Error).message}`); }

  // 2. Check project builds
  const pkgPath = resolve(repoRoot, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
      // Try tsc if it's a TS project
      if (pkg.devDependencies?.typescript || pkg.dependencies?.typescript) {
        try {
          execSync("npx tsc --noEmit", { cwd: repoRoot, timeout: 60_000, stdio: "pipe", windowsHide: true });
        } catch (err) {
          console.error(`[preflight] tsc --noEmit failed: ${(err as Error).message}`);
          errors.push("Project does not compile (npx tsc --noEmit failed)");
        }
      }
    } catch (err) { console.warn(`[preflight] invalid package.json: ${(err as Error).message}`); }
  }

  // 3. Check existing tests pass
  const testResult = runProjectTests(repoRoot);
  if (testResult.ran && !testResult.passed) {
    errors.push(`Existing tests failing before orchestrate: ${testResult.summary}`);
  }

  // 4. Collect fitness baseline
  try {
    const srcDir = resolve(repoRoot, "src");
    const allFiles = existsSync(srcDir)
      ? walkSourceFiles(srcDir, n => /\.[jt]sx?$/.test(n)).map(f => f.replace(repoRoot + sep, ""))
      : [];
    if (allFiles.length > 0) {
      const signals = collectFitnessSignals(repoRoot, allFiles);
      const score = computeFitness(signals);
      fitnessBaseline = score.total;
    }
  } catch (err) { console.warn(`[preflight] fitness baseline skipped: ${(err as Error).message}`); }

  return { errors, warnings, fitnessBaseline };
}
