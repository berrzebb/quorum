/**
 * Fitness Score Engine — deterministic quality measurement.
 *
 * Combines AST metrics, test coverage, pattern scan results, and build health
 * into a single 0.0–1.0 fitness score. Inspired by Karpathy's autoresearch
 * pattern: measure numerically, gate on score, not on LLM opinion.
 *
 * Principle: **measurable things are not asked to the LLM.**
 */

import { randomUUID } from "node:crypto";
import type {
  FitnessScore,
  FitnessComponent,
  FitnessDelta,
} from "./events.js";

// Re-export for convenience
export type { FitnessScore, FitnessComponent, FitnessDelta };

// ── Input signals ────────────────────────────────────

export interface FitnessSignals {
  /** Number of `as any` / `as unknown` casts (from AST analyzer). */
  typeAssertionCount?: number;
  /** Total effective lines analyzed. */
  effectiveLines?: number;
  /** tsc --noEmit exit code: 0 = pass. */
  tscExitCode?: number;
  /** Number of tsc errors. */
  tscErrorCount?: number;
  /** eslint exit code: 0 = pass. */
  eslintExitCode?: number;
  /** Line coverage percentage (0-100). */
  lineCoverage?: number;
  /** Branch coverage percentage (0-100). */
  branchCoverage?: number;
  /** Number of HIGH-severity pattern scan findings. */
  highFindings?: number;
  /** Total pattern scan findings (all severities). */
  totalFindings?: number;
  /** Average cyclomatic complexity across functions. */
  avgComplexity?: number;
  /** Max cyclomatic complexity across functions. */
  maxComplexity?: number;
  /** Number of security issues (from security domain scan). */
  securityIssues?: number;
  /** Number of deprecated or vulnerable dependencies. */
  deprecatedDeps?: number;
  /** Total dependency count (for normalization). */
  totalDeps?: number;
}

export interface FitnessConfig {
  weights?: Partial<Record<keyof FitnessScore["components"], number>>;
  /** Thresholds for normalization. */
  thresholds?: {
    /** assertions per 1000 lines above which score = 0 (default: 20). */
    assertionsPerKLOC?: number;
    /** Coverage below which score = 0 (default: 0). */
    minCoverage?: number;
    /** Complexity above which score = 0 (default: 25). */
    maxComplexity?: number;
    /** HIGH findings count above which score = 0 (default: 10). */
    maxHighFindings?: number;
    /** Security issues above which score = 0 (default: 5). */
    maxSecurityIssues?: number;
    /** Deprecated dep ratio above which score = 0 (default: 0.3 = 30%). */
    maxDeprecatedRatio?: number;
  };
}

// ── Default weights ──────────────────────────────────

const DEFAULT_WEIGHTS = {
  typeSafety: 0.20,
  testCoverage: 0.20,
  patternScan: 0.20,
  buildHealth: 0.15,
  complexity: 0.10,
  security: 0.10,
  dependencies: 0.05,
};

const DEFAULT_THRESHOLDS = {
  assertionsPerKLOC: 20,
  minCoverage: 0,
  maxComplexity: 25,
  maxHighFindings: 10,
  maxSecurityIssues: 5,
  maxDeprecatedRatio: 0.3,
};

// ── Core computation ─────────────────────────────────

/**
 * Compute a fitness score from raw signals.
 *
 * Each component is normalized to 0.0–1.0 (higher = better),
 * then weighted to produce a total score.
 */
export function computeFitness(
  signals: FitnessSignals,
  config?: FitnessConfig,
): FitnessScore {
  const w = { ...DEFAULT_WEIGHTS, ...config?.weights };
  const t = { ...DEFAULT_THRESHOLDS, ...config?.thresholds };

  // 1. Type Safety: fewer assertions per KLOC = better
  const kloc = Math.max((signals.effectiveLines ?? 0) / 1000, 0.1);
  const assertionsPerKLOC = (signals.typeAssertionCount ?? 0) / kloc;
  const typeSafetyValue = clamp(1 - assertionsPerKLOC / t.assertionsPerKLOC);

  // 2. Test Coverage: higher = better (average of line + branch)
  const lineCov = (signals.lineCoverage ?? 0) / 100;
  const branchCov = (signals.branchCoverage ?? 0) / 100;
  const testCoverageValue = (lineCov + branchCov) / 2;

  // 3. Pattern Scan: fewer HIGH findings = better
  const highFindings = signals.highFindings ?? 0;
  const patternScanValue = clamp(1 - highFindings / t.maxHighFindings);

  // 4. Build Health: tsc and eslint pass = 1.0
  const tscPass = (signals.tscExitCode ?? 0) === 0 ? 1 : 0;
  const eslintPass = (signals.eslintExitCode ?? 0) === 0 ? 1 : 0;
  const buildHealthValue = (tscPass + eslintPass) / 2;

  // 5. Complexity: lower average = better
  const avgCC = signals.avgComplexity ?? 0;
  const complexityValue = clamp(1 - avgCC / t.maxComplexity);

  // 6. Security: fewer issues = better
  const secIssues = signals.securityIssues ?? 0;
  const securityValue = clamp(1 - secIssues / t.maxSecurityIssues);

  // 7. Dependencies: fewer deprecated/vulnerable = better
  const totalDeps = Math.max(signals.totalDeps ?? 1, 1);
  const deprecatedRatio = (signals.deprecatedDeps ?? 0) / totalDeps;
  const dependenciesValue = clamp(1 - deprecatedRatio / t.maxDeprecatedRatio);

  const components: FitnessScore["components"] = {
    typeSafety: { value: typeSafetyValue, raw: assertionsPerKLOC, weight: w.typeSafety, label: "Type Safety" },
    testCoverage: { value: testCoverageValue, raw: (signals.lineCoverage ?? 0), weight: w.testCoverage, label: "Test Coverage" },
    patternScan: { value: patternScanValue, raw: highFindings, weight: w.patternScan, label: "Pattern Scan" },
    buildHealth: { value: buildHealthValue, raw: tscPass + eslintPass, weight: w.buildHealth, label: "Build Health" },
    complexity: { value: complexityValue, raw: avgCC, weight: w.complexity, label: "Complexity" },
    security: { value: securityValue, raw: secIssues, weight: w.security, label: "Security" },
    dependencies: { value: dependenciesValue, raw: deprecatedRatio, weight: w.dependencies, label: "Dependencies" },
  };

  // Weighted total
  const total = Object.values(components).reduce(
    (sum, c) => sum + c.value * c.weight, 0
  );

  return {
    total: round(total),
    components,
    timestamp: Date.now(),
    snapshotId: randomUUID(),
  };
}

/**
 * Compute the delta between two fitness snapshots.
 */
export function computeDelta(
  before: FitnessScore,
  after: FitnessScore,
): FitnessDelta {
  const componentDeltas: FitnessDelta["components"] = {};
  for (const [key, comp] of Object.entries(after.components)) {
    const prev = before.components[key as keyof FitnessScore["components"]];
    const prevValue = prev?.value ?? 0;
    componentDeltas[key] = {
      before: round(prevValue),
      after: round(comp.value),
      delta: round(comp.value - prevValue),
    };
  }

  const delta = round(after.total - before.total);
  return {
    before: round(before.total),
    after: round(after.total),
    delta,
    improved: delta > 0,
    components: componentDeltas,
  };
}

/**
 * Compute a moving average and slope from a series of scores.
 *
 * @param scores Recent fitness totals (newest last)
 * @param windowSize Window for the moving average
 */
export function computeTrend(
  scores: number[],
  windowSize = 5,
): { movingAverage: number; slope: number } {
  if (scores.length === 0) return { movingAverage: 0, slope: 0 };

  const window = scores.slice(-windowSize);
  const movingAverage = round(window.reduce((a, b) => a + b, 0) / window.length);

  // Simple linear regression slope over the window
  if (window.length < 2) return { movingAverage, slope: 0 };

  const n = window.length;
  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += window[i];
    sumXY += i * window[i];
    sumXX += i * i;
  }
  const denom = n * sumXX - sumX * sumX;
  const slope = denom === 0 ? 0 : round((n * sumXY - sumX * sumY) / denom);

  return { movingAverage, slope };
}

// ── Helpers ──────────────────────────────────────────

function clamp(value: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, value));
}

function round(value: number, decimals = 4): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
