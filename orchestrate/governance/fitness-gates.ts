/**
 * Fitness gates — quality score collection + threshold evaluation.
 *
 * Pure measurement logic: tsc, stub scan, line count → fitness score → gate decision.
 * No execution logic, no agent spawning.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { execSync } from "node:child_process";
import { computeFitness } from "../../bus/fitness.js";
import type { FitnessSignals } from "../../bus/fitness.js";
import { FitnessLoop } from "../../bus/fitness-loop.js";
import { scanForStubs } from "./scope-gates.js";

// ── Types ────────────────────────────────────

export interface FitnessGateResult {
  decision: "proceed" | "self-correct" | "auto-reject";
  score: number;
  reason: string;
  components?: Array<{ name: string; score: number }>;
}

// ── Signal Collection ────────────────────────

/**
 * Collect fitness signals mechanically from the project.
 * tsc, stub count, pattern findings — all deterministic, no LLM.
 */
export function collectFitnessSignals(repoRoot: string, changedFiles: string[]): FitnessSignals {
  // 1. tsc --noEmit
  let tscExitCode = 0;
  let tscErrorCount = 0;
  try {
    execSync("npx tsc --noEmit 2>&1", { cwd: repoRoot, timeout: 60_000, stdio: "pipe", windowsHide: true });
  } catch (e: any) {
    tscExitCode = 1;
    const stderr = (e?.stdout?.toString?.() ?? "") + (e?.stderr?.toString?.() ?? "");
    tscErrorCount = (stderr.match(/error TS/g) ?? []).length;
  }

  // 2. Stub scan → treat as HIGH findings
  const stubs = scanForStubs(repoRoot, changedFiles);

  // 3. Effective lines (rough count of changed files)
  let effectiveLines = 0;
  for (const f of changedFiles) {
    const abs = resolve(repoRoot, f);
    if (existsSync(abs)) {
      try {
        effectiveLines += readFileSync(abs, "utf8").split("\n").length;
      } catch { /* skip */ }
    }
  }

  // 4. Test coverage — skipped for per-wave gate (too slow).
  // Rely on runProjectTests() running tests separately.
  const lineCoverage = 0;
  const branchCoverage = 0;

  return {
    tscExitCode,
    tscErrorCount,
    highFindings: stubs.length,
    totalFindings: stubs.length,
    effectiveLines,
    lineCoverage,
    branchCoverage,
  };
}

// ── Gate Evaluation ──────────────────────────

/**
 * Run fitness gate on wave changes.
 * Returns decision: proceed (continue to LLM audit), self-correct (warn), auto-reject (skip audit, fix).
 */
export function runFitnessGate(repoRoot: string, changedFiles: string[], store: any): FitnessGateResult {
  const signals = collectFitnessSignals(repoRoot, changedFiles);
  const score = computeFitness(signals);
  const loop = new FitnessLoop(store ?? null);
  const result = loop.evaluate(score);

  // Extract component scores for detailed feedback
  const components = Object.entries(score.components).map(([name, comp]: [string, any]) => ({
    name,
    score: typeof comp === "object" ? (comp.score ?? comp.value ?? 0) : 0,
  }));

  return {
    decision: result.decision,
    score: score.total,
    reason: result.reason,
    components,
  };
}

// Re-export computeFitness for pre-flight baseline
export { computeFitness };
