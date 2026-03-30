/**
 * Wave-level audit loop — orchestrates governance gate checks in sequence.
 *
 * Calls mechanical gates (scope, fitness, regression, blueprint, etc.) and
 * collects all findings into a structured result. No fixer logic, no LLM
 * audit invocation, no console output — pure gate orchestration.
 */

import type { WorkItem, Wave, Bridge } from "../planning/types.js";
import type { NamingRule } from "../../bus/blueprint-parser.js";
import {
  runFitnessGate,
  type FitnessGateResult,
} from "../governance/fitness-gates.js";
import {
  STUB_PATTERNS,
  PERF_PATTERNS,
  scanLines,
  getChangedFiles,
  detectFileScopeViolations,
  scanBlueprintViolations,
  detectRegressions,
  auditNewDependencies,
  checkTestFileCreation,
  checkWBConstraints,
} from "../governance/scope-gates.js";

/** Pre-merged patterns + description set — module-level constants. */
const STUB_PERF_PATTERNS = [...STUB_PATTERNS, ...PERF_PATTERNS];
const PERF_DESCS = new Set(PERF_PATTERNS.map(([, d]) => d));

// ── Types ────────────────────────────────────

/** Structured result of all mechanical governance gates for a wave. */
export interface WaveAuditResult {
  /** True only if all blocking gates passed (no stubs, no regressions, fitness not auto-reject). */
  passed: boolean;
  /** Fitness gate decision: proceed / self-correct / auto-reject. */
  fitnessDecision: "proceed" | "self-correct" | "auto-reject";
  /** Fitness gate full result. */
  fitnessResult: FitnessGateResult;
  /** Files that were actually changed (git diff against snapshot). */
  changedFiles: string[];
  /** Target files from completed items (deduplicated). */
  waveFiles: string[];
  /** Completed WorkItems in this wave. */
  completedItems: WorkItem[];

  // ── Gate findings ──────────────────────────

  /** Regression findings (overwrite detection via git numstat). */
  regressions: string[];
  /** Stub/placeholder findings in wave files. */
  stubs: string[];
  /** Performance anti-pattern findings. */
  perfFindings: string[];
  /** Blueprint naming violations (blocking). */
  blueprintViolations: string[];
  /** File scope violations (out-of-scope edits). */
  scopeViolations: string[];
  /** New dependency audit issues. */
  dependencyIssues: string[];
  /** Missing test file warnings. */
  missingTests: string[];
  /** WB constraint violations. */
  constraintViolations: string[];
  /** Whether blueprint violations blocked the audit. */
  blueprintBlocked: boolean;
}

/** Options for running the wave-level audit gate chain. */
export interface WaveAuditOptions {
  /** Absolute path to project root. */
  repoRoot: string;
  /** Wave being audited. */
  wave: Wave;
  /** Set of completed item IDs (across all waves). */
  completedIds: Set<string>;
  /** Git snapshot ref captured before the wave started. */
  snapshotRef: string;
  /** Blueprint naming rules from design docs (empty if none). */
  blueprintRules: NamingRule[];
  /** Bridge instance (for EventStore access). */
  bridge: Bridge | null;
}

// ── Main Entry Point ────────────────────────

/**
 * Run all mechanical governance gates for a completed wave.
 *
 * Gate sequence:
 *   1. Collect changed files + dependency issues
 *   2. Regression detection
 *   3. Stub scan
 *   4. Perf anti-pattern scan
 *   5. Blueprint naming lint
 *   6. File scope enforcement
 *   7. Fitness gate
 *   8. Test file creation check
 *   9. WB constraint check
 *
 * Returns a structured result. The caller decides what to do with it
 * (print, invoke fixer, rollback, etc.).
 */
export function runWaveAuditGates(opts: WaveAuditOptions): WaveAuditResult {
  const { repoRoot, wave, completedIds, snapshotRef, blueprintRules, bridge } = opts;

  // Identify completed items and their target files
  const completedItems = wave.items.filter(i => completedIds.has(i.id));
  const waveFiles = [...new Set(completedItems.flatMap(i => i.targetFiles))];

  // 1. Changed files + dependency audit
  const changedFiles = getChangedFiles(repoRoot, snapshotRef);
  const dependencyIssues = waveFiles.length > 0
    ? auditNewDependencies(repoRoot, snapshotRef)
    : [];

  // 2. Regression detection
  const regressions = detectRegressions(repoRoot, waveFiles, snapshotRef);

  // Early return if no completed items
  if (completedItems.length === 0) {
    return {
      passed: true,
      fitnessDecision: "proceed",
      fitnessResult: { decision: "proceed", score: 0, reason: "no items" },
      changedFiles,
      waveFiles,
      completedItems,
      regressions,
      stubs: [],
      perfFindings: [],
      blueprintViolations: [],
      scopeViolations: [],
      dependencyIssues,
      missingTests: [],
      constraintViolations: [],
      blueprintBlocked: false,
    };
  }

  // 3-4. Combined stub + perf scan (single file read pass instead of two)
  const stubPerfFindings = scanLines(repoRoot, waveFiles, STUB_PERF_PATTERNS);
  const stubs: string[] = [];
  const perfFindings: string[] = [];
  for (const f of stubPerfFindings) {
    const desc = f.slice(f.indexOf(" — ") + 3);
    (PERF_DESCS.has(desc) ? perfFindings : stubs).push(f);
  }

  // 5. Blueprint naming lint
  const blueprintViolations = blueprintRules.length > 0
    ? scanBlueprintViolations(repoRoot, waveFiles, blueprintRules)
    : [];

  // 6. File scope enforcement
  const scopeViolations = detectFileScopeViolations(repoRoot, completedItems, changedFiles);

  // 7. Fitness gate (pass precomputed stub count to avoid re-scanning files)
  const store = bridge?.store ?? null;
  const fg = runFitnessGate(repoRoot, waveFiles, store, { stubCount: stubs.length });
  const blueprintBlocked = blueprintViolations.length > 0;
  const fitnessDecision = blueprintBlocked ? "auto-reject" as const : fg.decision;

  // 8. Test file creation check
  const missingTests = checkTestFileCreation(repoRoot, completedItems, changedFiles);

  // 9. WB constraint check
  const constraintViolations = checkWBConstraints(repoRoot, completedItems, dependencyIssues);

  // Determine overall pass: blocking gates must be clear
  const passed = regressions.length === 0
    && stubs.length === 0
    && !blueprintBlocked
    && fitnessDecision !== "auto-reject";

  return {
    passed,
    fitnessDecision,
    fitnessResult: fg,
    changedFiles,
    waveFiles,
    completedItems,
    regressions,
    stubs,
    perfFindings,
    blueprintViolations,
    scopeViolations,
    dependencyIssues,
    missingTests,
    constraintViolations,
    blueprintBlocked,
  };
}
