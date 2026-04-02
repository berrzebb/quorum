/**
 * Fitness gates — quality score collection + threshold evaluation.
 *
 * Pure measurement logic: tsc, stub scan, line count → fitness score → gate decision.
 * No execution logic, no agent spawning.
 */

import { readFileSync } from "node:fs";
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

// ── TSC Result Cache ────────────────────────

/** Cached tsc --noEmit result (shared across waves within a track). */
export interface TscCacheEntry { exitCode: number; errorCount: number; ts: number }
let _tscCache: TscCacheEntry | null = null;
const TSC_CACHE_TTL = 120_000; // 2 minutes — covers a full wave cycle

/**
 * Run tsc --noEmit with caching. Within a single track run (~2min per wave),
 * tsc result is stable unless source files change. Avoids re-running the
 * most expensive gate operation (5-30s) on every wave.
 */
export function runTscCached(repoRoot: string): TscCacheEntry {
  if (_tscCache && Date.now() - _tscCache.ts < TSC_CACHE_TTL) return _tscCache;
  let exitCode = 0;
  let errorCount = 0;
  try {
    execSync("npx tsc --noEmit 2>&1", { cwd: repoRoot, timeout: 60_000, stdio: "pipe", windowsHide: true });
  } catch (e: any) {
    exitCode = 1;
    const stderr = (e?.stdout?.toString?.() ?? "") + (e?.stderr?.toString?.() ?? "");
    errorCount = (stderr.match(/error TS/g) ?? []).length;
    console.warn(`[fitness-gates] tsc --noEmit failed: ${errorCount} error(s)`);
  }
  _tscCache = { exitCode, errorCount, ts: Date.now() };
  return _tscCache;
}

/** Invalidate tsc cache (call after fixer modifies code). */
export function invalidateTscCache(): void { _tscCache = null; }

// ── Signal Collection ────────────────────────

/**
 * Pre-computed signals that callers can inject to avoid redundant file I/O.
 * audit-loop already scans files for stubs + counts lines — pass those here.
 */
export interface PrecomputedSignals {
  stubCount?: number;
  effectiveLines?: number;
}

/**
 * Collect fitness signals mechanically from the project.
 * tsc (cached), stub count, pattern findings — all deterministic, no LLM.
 * Accepts optional precomputed signals to avoid redundant file reads.
 */
export function collectFitnessSignals(repoRoot: string, changedFiles: string[], precomputed?: PrecomputedSignals): FitnessSignals {
  // 1. tsc --noEmit (cached within track run)
  const tsc = runTscCached(repoRoot);

  // 2. Stub count — use precomputed if available (audit-loop already scanned)
  const stubCount = precomputed?.stubCount ?? scanForStubs(repoRoot, changedFiles).length;

  // 3. Effective lines — use precomputed if available
  let effectiveLines = precomputed?.effectiveLines ?? 0;
  if (precomputed?.effectiveLines === undefined) {
    for (const f of changedFiles) {
      const abs = resolve(repoRoot, f);
      try {
        effectiveLines += readFileSync(abs, "utf8").split("\n").length;
      } catch (err) { console.warn(`[fitness-gates] skipped ${f}: ${(err as Error).message}`); }
    }
  }

  return {
    tscExitCode: tsc.exitCode,
    tscErrorCount: tsc.errorCount,
    highFindings: stubCount,
    totalFindings: stubCount,
    effectiveLines,
    lineCoverage: 0,
    branchCoverage: 0,
  };
}

// ── Gate Evaluation ──────────────────────────

/**
 * Run fitness gate on wave changes.
 * Returns decision: proceed (continue to LLM audit), self-correct (warn), auto-reject (skip audit, fix).
 */
export function runFitnessGate(repoRoot: string, changedFiles: string[], store: any, precomputed?: PrecomputedSignals): FitnessGateResult {
  const signals = collectFitnessSignals(repoRoot, changedFiles, precomputed);
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

// ── v0.6.0 Simplified Fitness Interface ─────

/** v0.6.0 simplified fitness result — pass/fail only by default. */
export interface FitnessResult {
  pass: boolean;
  score?: number;
  components?: Array<{ name: string; score: number }>;
}

/**
 * Check fitness as pass/fail (v0.6.0 default mode).
 * Mapping: proceed → pass, self-correct/auto-reject → fail.
 * With verbose=true, includes score and 7-component details.
 */
export function checkFitnessPassFail(
  repoRoot: string,
  changedFiles: string[],
  store: any,
  options?: { verbose?: boolean; precomputed?: PrecomputedSignals },
): FitnessResult {
  const gate = runFitnessGate(repoRoot, changedFiles, store, options?.precomputed);
  const pass = gate.decision === "proceed";

  if (options?.verbose) {
    return { pass, score: gate.score, components: gate.components };
  }
  return { pass };
}

// Re-export computeFitness for pre-flight baseline
export { computeFitness };
