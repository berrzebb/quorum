/**
 * Stagnation Detection — 7 patterns that indicate the audit loop is cycling without progress.
 *
 * Analyzes event history to detect:
 * 1. Spinning: same verdict output 3+ times (SHA-256 hash)
 * 2. Oscillation: A→B→A→B alternation pattern
 * 3. No drift: verdict score unchanged across consecutive audits
 * 4. Diminishing returns: improvement rate monotonically declining
 * 5. Fitness plateau: fitness score slope near-zero
 * 6. Expansion: rejection codes increasing (getting worse, not better)
 * 7. Consensus divergence: opinion confidence declining across rounds
 *
 * Returns detection results with confidence scores and recommended actions.
 */

import { createHash } from "node:crypto";
import type { QuorumEvent } from "./events.js";
import { computeTrend } from "./fitness.js";

export type StagnationPattern = "spinning" | "oscillation" | "no-drift" | "diminishing-returns" | "fitness-plateau" | "expansion" | "consensus-divergence";

export interface StagnationResult {
  detected: boolean;
  patterns: DetectedPattern[];
  recommendation: "continue" | "escalate" | "halt" | "lateral";
}

export interface DetectedPattern {
  type: StagnationPattern;
  confidence: number;
  detail: string;
}

export interface StagnationConfig {
  /** Min consecutive identical outputs to detect spinning (default: 3). */
  spinThreshold?: number;
  /** Min alternation cycles to detect oscillation (default: 2). */
  oscillationCycles?: number;
  /** Max score delta to consider "no drift" (default: 0.01). */
  driftEpsilon?: number;
  /** Min consecutive declining improvements (default: 3). */
  diminishingWindow?: number;
  /** Max slope magnitude to consider fitness plateau (default: 0.005). */
  plateauEpsilon?: number;
  /** Min data points before plateau detection (default: 5). */
  plateauMinPoints?: number;
  /** Min consecutive rounds of increasing codes to detect expansion (default: 3). */
  expansionWindow?: number;
  /** Min rounds for consensus divergence detection (default: 3). */
  divergenceWindow?: number;
}

const DEFAULTS: Required<StagnationConfig> = {
  spinThreshold: 3,
  oscillationCycles: 2,
  driftEpsilon: 0.01,
  diminishingWindow: 3,
  plateauEpsilon: 0.005,
  plateauMinPoints: 5,
  expansionWindow: 3,
  divergenceWindow: 3,
};

/**
 * Analyze audit verdict events for stagnation patterns.
 * Pass the full event history (or recent slice) of audit.verdict events.
 */
export function detectStagnation(
  verdictEvents: QuorumEvent[],
  config: StagnationConfig = {},
  fitnessHistory?: number[],
): StagnationResult {
  const cfg = { ...DEFAULTS, ...config };
  const patterns: DetectedPattern[] = [];

  if (verdictEvents.length < 3) {
    return { detected: false, patterns: [], recommendation: "continue" };
  }

  // Extract verdict summaries for comparison
  const summaries = verdictEvents.map((e) => ({
    verdict: e.payload.verdict as string,
    codes: ((e.payload.codes as string[]) ?? []).sort().join(","),
    summary: (e.payload.summary as string) ?? "",
  }));

  // 1. Spinning detection (SHA-256 hash comparison)
  const spinning = detectSpinning(summaries, cfg.spinThreshold);
  if (spinning) patterns.push(spinning);

  // 2. Oscillation detection (A→B→A→B)
  const oscillation = detectOscillation(summaries, cfg.oscillationCycles);
  if (oscillation) patterns.push(oscillation);

  // 3. No drift detection (verdict unchanged)
  const noDrift = detectNoDrift(summaries, cfg.driftEpsilon);
  if (noDrift) patterns.push(noDrift);

  // 4. Diminishing returns
  const diminishing = detectDiminishingReturns(verdictEvents, cfg.diminishingWindow);
  if (diminishing) patterns.push(diminishing);

  // 5. Fitness plateau (requires fitnessHistory from FitnessLoop)
  if (fitnessHistory && fitnessHistory.length >= cfg.plateauMinPoints) {
    const plateau = detectFitnessPlateau(fitnessHistory, cfg.plateauEpsilon, cfg.plateauMinPoints);
    if (plateau) patterns.push(plateau);
  }

  // 6. Expansion: verdict codes increasing (getting worse)
  const expansion = detectExpansion(verdictEvents, cfg.expansionWindow);
  if (expansion) patterns.push(expansion);

  // 7. Consensus divergence: opinion agreement declining across rounds
  const divergence = detectConsensusDivergence(verdictEvents, cfg.divergenceWindow);
  if (divergence) patterns.push(divergence);

  const detected = patterns.length > 0;
  const recommendation = deriveRecommendation(patterns);

  return { detected, patterns, recommendation };
}

// ── Pattern detectors ─────────────────────────

function hash(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 16);
}

function detectSpinning(
  summaries: { verdict: string; codes: string; summary: string }[],
  threshold: number,
): DetectedPattern | null {
  // Filter out approved verdicts — repeated approval is not stagnation
  const rejections = summaries.filter((s) => s.verdict !== "approved");
  if (rejections.length < threshold) return null;
  const hashes = rejections.map((s) => hash(`${s.verdict}|${s.codes}`));
  let maxRun = 1;
  let currentRun = 1;

  for (let i = 1; i < hashes.length; i++) {
    if (hashes[i] === hashes[i - 1]) {
      currentRun++;
      maxRun = Math.max(maxRun, currentRun);
    } else {
      currentRun = 1;
    }
  }

  if (maxRun >= threshold) {
    return {
      type: "spinning",
      confidence: Math.min(1, maxRun / (threshold + 2)),
      detail: `Same verdict repeated ${maxRun} times consecutively`,
    };
  }
  return null;
}

function detectOscillation(
  summaries: { verdict: string; codes: string }[],
  minCycles: number,
): DetectedPattern | null {
  if (summaries.length < minCycles * 2 + 1) return null;

  const verdicts = summaries.map((s) => s.verdict);
  let cycles = 0;

  for (let i = 2; i < verdicts.length; i++) {
    if (verdicts[i] === verdicts[i - 2] && verdicts[i] !== verdicts[i - 1]) {
      cycles++;
    }
  }

  if (cycles >= minCycles) {
    return {
      type: "oscillation",
      confidence: Math.min(1, cycles / (minCycles + 1)),
      detail: `Verdict alternates ${cycles} times (A→B→A pattern)`,
    };
  }
  return null;
}

function detectNoDrift(
  summaries: { verdict: string; codes: string }[],
  _epsilon: number,
): DetectedPattern | null {
  if (summaries.length < 3) return null;

  // Check if last N verdicts have identical codes
  const recent = summaries.slice(-3);
  const allSame = recent.every((s) => s.verdict === recent[0]!.verdict && s.codes === recent[0]!.codes);

  if (allSame && recent[0]!.verdict === "changes_requested") {
    return {
      type: "no-drift",
      confidence: 0.8,
      detail: `Last ${recent.length} verdicts identical: ${recent[0]!.verdict} [${recent[0]!.codes}]`,
    };
  }
  return null;
}

function detectDiminishingReturns(
  events: QuorumEvent[],
  window: number,
): DetectedPattern | null {
  // Count rejection codes per verdict — fewer codes = improvement
  const codeCounts = events.map((e) => ((e.payload.codes as string[]) ?? []).length);
  if (codeCounts.length < window + 1) return null;

  // Calculate deltas (improvement rate)
  const deltas: number[] = [];
  for (let i = 1; i < codeCounts.length; i++) {
    deltas.push(codeCounts[i - 1]! - codeCounts[i]!); // positive = improvement
  }

  // Check if recent deltas are monotonically declining
  const recent = deltas.slice(-window);
  let declining = true;
  for (let i = 1; i < recent.length; i++) {
    if (recent[i]! >= recent[i - 1]!) {
      declining = false;
      break;
    }
  }

  if (declining && recent.length >= window) {
    return {
      type: "diminishing-returns",
      confidence: 0.7,
      detail: `Improvement rate declining over last ${window} audits`,
    };
  }
  return null;
}

function detectFitnessPlateau(
  history: number[],
  epsilon: number,
  minPoints: number,
): DetectedPattern | null {
  if (history.length < minPoints) return null;

  const { slope, movingAverage } = computeTrend(history, minPoints);

  if (Math.abs(slope) <= epsilon) {
    return {
      type: "fitness-plateau",
      confidence: Math.min(1, 1 - Math.abs(slope) / epsilon),
      detail: `Fitness score plateaued at ${movingAverage.toFixed(3)} (slope: ${slope.toFixed(4)}) over ${minPoints} evaluations`,
    };
  }
  return null;
}

function detectExpansion(
  events: QuorumEvent[],
  window: number,
): DetectedPattern | null {
  // Count rejection codes per verdict — increasing codes = getting worse
  const codeCounts = events.map((e) => ((e.payload.codes as string[]) ?? []).length);
  if (codeCounts.length < window + 1) return null;

  const recent = codeCounts.slice(-window - 1);
  let expanding = true;
  for (let i = 1; i < recent.length; i++) {
    if (recent[i]! <= recent[i - 1]!) {
      expanding = false;
      break;
    }
  }

  if (expanding) {
    const firstCount = recent[0]!;
    const lastCount = recent[recent.length - 1]!;
    return {
      type: "expansion",
      confidence: Math.min(1, (lastCount - firstCount) / Math.max(firstCount, 1)),
      detail: `Rejection codes increasing: ${firstCount} → ${lastCount} over ${window} rounds`,
    };
  }
  return null;
}

function detectConsensusDivergence(
  events: QuorumEvent[],
  window: number,
): DetectedPattern | null {
  // Check if confidence scores are declining across recent verdicts
  const confidences = events
    .map((e) => e.payload.confidence as number | undefined)
    .filter((c): c is number => c !== undefined);

  if (confidences.length < window) return null;

  const recent = confidences.slice(-window);
  let declining = true;
  for (let i = 1; i < recent.length; i++) {
    if (recent[i]! >= recent[i - 1]!) {
      declining = false;
      break;
    }
  }

  if (declining) {
    return {
      type: "consensus-divergence",
      confidence: Math.min(1, (recent[0]! - recent[recent.length - 1]!) / Math.max(recent[0]!, 0.01)),
      detail: `Consensus confidence declining: ${recent[0]!.toFixed(2)} → ${recent[recent.length - 1]!.toFixed(2)} over ${window} rounds`,
    };
  }
  return null;
}

// ── Recommendation logic ──────────────────────

function deriveRecommendation(patterns: DetectedPattern[]): StagnationResult["recommendation"] {
  if (patterns.length === 0) return "continue";

  let maxConfidence = 0;
  const types = new Set<string>();
  for (const p of patterns) {
    types.add(p.type);
    if (p.confidence > maxConfidence) maxConfidence = p.confidence;
  }

  // Spinning + oscillation = likely stuck → halt
  if (types.has("spinning") && types.has("oscillation")) return "halt";

  // High-confidence spinning → try lateral thinking
  if (types.has("spinning") && maxConfidence > 0.8) return "lateral";

  // No drift → escalate to higher tier
  if (types.has("no-drift")) return "escalate";

  // Diminishing returns → escalate
  if (types.has("diminishing-returns")) return "escalate";

  // Fitness plateau → escalate (scores not improving despite changes)
  if (types.has("fitness-plateau")) return "escalate";

  // Expansion (getting worse) → halt immediately
  if (types.has("expansion") && maxConfidence > 0.6) return "halt";
  if (types.has("expansion")) return "lateral";

  // Consensus divergence → lateral (try different approach)
  if (types.has("consensus-divergence")) return "lateral";

  return "escalate";
}
