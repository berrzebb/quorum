/**
 * Stagnation Detection — 4 patterns that indicate the audit loop is cycling without progress.
 *
 * Analyzes event history to detect:
 * 1. Spinning: same verdict output 3+ times (SHA-256 hash)
 * 2. Oscillation: A→B→A→B alternation pattern
 * 3. No drift: verdict score unchanged across consecutive audits
 * 4. Diminishing returns: improvement rate monotonically declining
 *
 * Returns detection results with confidence scores and recommended actions.
 */

import { createHash } from "node:crypto";
import type { QuorumEvent } from "./events.js";

export type StagnationPattern = "spinning" | "oscillation" | "no-drift" | "diminishing-returns";

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
}

const DEFAULTS: Required<StagnationConfig> = {
  spinThreshold: 3,
  oscillationCycles: 2,
  driftEpsilon: 0.01,
  diminishingWindow: 3,
};

/**
 * Analyze audit verdict events for stagnation patterns.
 * Pass the full event history (or recent slice) of audit.verdict events.
 */
export function detectStagnation(
  verdictEvents: QuorumEvent[],
  config: StagnationConfig = {},
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
  const hashes = summaries.map((s) => hash(`${s.verdict}|${s.codes}`));
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

// ── Recommendation logic ──────────────────────

function deriveRecommendation(patterns: DetectedPattern[]): StagnationResult["recommendation"] {
  if (patterns.length === 0) return "continue";

  const types = new Set(patterns.map((p) => p.type));
  const maxConfidence = Math.max(...patterns.map((p) => p.confidence));

  // Spinning + oscillation = likely stuck → halt
  if (types.has("spinning") && types.has("oscillation")) return "halt";

  // High-confidence spinning → try lateral thinking
  if (types.has("spinning") && maxConfidence > 0.8) return "lateral";

  // No drift → escalate to higher tier
  if (types.has("no-drift")) return "escalate";

  // Diminishing returns → escalate
  if (types.has("diminishing-returns")) return "escalate";

  return "escalate";
}
