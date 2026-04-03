/**
 * Trigger Learner — self-learning trigger weight adjustment.
 *
 * Tracks trigger predictions vs audit outcomes, adjusts factor weights
 * to reduce false positives (T3→agree) and false negatives (T1→reject).
 *
 * Weight bounds: [0.5, 2.0] per factor (no extreme drift).
 * Adjustment: false positive → -5%, false negative → +10%.
 *
 * @module bus/trigger-learner
 */

// ── Types ───────────────────────────────────────────

/** Trigger evaluation record (from trigger.evaluation event). */
export interface TriggerEvaluation {
  id: string;
  score: number;
  tier: "T1" | "T2" | "T3";
  factors: Record<string, number>;
  timestamp: number;
}

/** Outcome record matching trigger prediction to audit verdict. */
export interface TriggerOutcome {
  evaluationId: string;
  predictedTier: "T1" | "T2" | "T3";
  actualVerdict: "agree" | "reject";
  isAccurate: boolean;
}

/** Accuracy statistics over a window. */
export interface AccuracyStats {
  total: number;
  accurate: number;
  falsePositive: number;
  falseNegative: number;
  accuracy: number;
}

/** A single weight adjustment. */
export interface WeightAdjustment {
  factor: string;
  oldWeight: number;
  newWeight: number;
  reason: "false_positive" | "false_negative";
}

/** KV store interface (subset of EventStore). */
export interface LearnerKVStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
  delete(key: string): void;
}

/** Event emitter interface (subset of EventStore). */
export interface LearnerEventEmitter {
  emit(type: string, payload: Record<string, unknown>): void;
}

// ── Constants ───────────────────────────────────────

/** Minimum samples before adjusting weights. */
export const DEFAULT_MIN_SAMPLES = 20;

/** Weight bounds — prevents extreme drift. */
export const WEIGHT_LOWER_BOUND = 0.5;
export const WEIGHT_UPPER_BOUND = 2.0;

/** Adjustment factors. */
const FALSE_POSITIVE_MULTIPLIER = 0.95; // -5%
const FALSE_NEGATIVE_MULTIPLIER = 1.10; // +10%

/** KV key for stored weights. */
const WEIGHTS_KV_KEY = "trigger.weights";

// ── Outcome Classification ──────────────────────────

/**
 * Determine if a trigger prediction was accurate.
 *
 * - T1 + agree → accurate (correctly skipped)
 * - T1 + reject → false negative (should have audited)
 * - T2 + any → accurate (middle tier, always acceptable)
 * - T3 + agree → false positive (over-audited)
 * - T3 + reject → accurate (correctly caught)
 */
export function classifyOutcome(
  predictedTier: "T1" | "T2" | "T3",
  actualVerdict: "agree" | "reject",
): { isAccurate: boolean; type: "accurate" | "false_positive" | "false_negative" } {
  if (predictedTier === "T2") return { isAccurate: true, type: "accurate" };
  if (predictedTier === "T1" && actualVerdict === "agree") return { isAccurate: true, type: "accurate" };
  if (predictedTier === "T1" && actualVerdict === "reject") return { isAccurate: false, type: "false_negative" };
  if (predictedTier === "T3" && actualVerdict === "reject") return { isAccurate: true, type: "accurate" };
  if (predictedTier === "T3" && actualVerdict === "agree") return { isAccurate: false, type: "false_positive" };
  return { isAccurate: true, type: "accurate" };
}

// ── Trigger Learner ─────────────────────────────────

/**
 * Self-learning trigger that adjusts factor weights based on prediction accuracy.
 */
export class TriggerLearner {
  private outcomes: TriggerOutcome[] = [];
  private evaluations = new Map<string, TriggerEvaluation>();

  constructor(
    private readonly kvStore?: LearnerKVStore,
    private readonly emitter?: LearnerEventEmitter,
  ) {}

  /** Record a trigger evaluation for later outcome matching. */
  recordEvaluation(evaluation: TriggerEvaluation): void {
    this.evaluations.set(evaluation.id, evaluation);
    this.emitter?.emit("trigger.evaluation", {
      score: evaluation.score,
      tier: evaluation.tier,
      factors: evaluation.factors,
      timestamp: evaluation.timestamp,
    });
  }

  /** Record the outcome of an audit verdict matched to a trigger evaluation. */
  recordOutcome(evaluationId: string, verdict: "agree" | "reject"): TriggerOutcome | null {
    const evaluation = this.evaluations.get(evaluationId);
    if (!evaluation) return null;

    const { isAccurate } = classifyOutcome(evaluation.tier, verdict);
    const outcome: TriggerOutcome = {
      evaluationId,
      predictedTier: evaluation.tier,
      actualVerdict: verdict,
      isAccurate,
    };

    this.outcomes.push(outcome);
    this.emitter?.emit("trigger.outcome", {
      evaluationId,
      predictedTier: evaluation.tier,
      actualVerdict: verdict,
      isAccurate,
    });

    return outcome;
  }

  /** Get accuracy statistics over the last N outcomes. */
  getAccuracyStats(lastN = 50): AccuracyStats {
    const window = this.outcomes.slice(-lastN);
    const total = window.length;
    if (total === 0) return { total: 0, accurate: 0, falsePositive: 0, falseNegative: 0, accuracy: 1.0 };

    let accurate = 0;
    let falsePositive = 0;
    let falseNegative = 0;

    for (const o of window) {
      const { type } = classifyOutcome(o.predictedTier, o.actualVerdict);
      switch (type) {
        case "accurate": accurate++; break;
        case "false_positive": falsePositive++; break;
        case "false_negative": falseNegative++; break;
      }
    }

    return { total, accurate, falsePositive, falseNegative, accuracy: accurate / total };
  }

  /**
   * Adjust factor weights based on accumulated outcomes.
   *
   * Requires minSamples outcomes before making adjustments.
   * Returns the adjustments made (empty if not enough samples).
   */
  adjustWeights(minSamples = DEFAULT_MIN_SAMPLES): WeightAdjustment[] {
    if (this.outcomes.length < minSamples) return [];

    const currentWeights = this.loadWeights();
    const adjustments: WeightAdjustment[] = [];

    // Count false positive/negative per factor
    const fpCount = new Map<string, number>(); // false positive
    const fnCount = new Map<string, number>(); // false negative

    for (const outcome of this.outcomes.slice(-minSamples)) {
      const evaluation = this.evaluations.get(outcome.evaluationId);
      if (!evaluation) continue;

      const { type } = classifyOutcome(outcome.predictedTier, outcome.actualVerdict);

      if (type === "false_positive") {
        // Find the highest contributing factor
        const topFactor = this.findTopFactor(evaluation.factors);
        if (topFactor) fpCount.set(topFactor, (fpCount.get(topFactor) ?? 0) + 1);
      } else if (type === "false_negative") {
        // Find the lowest contributing factor (should have been higher)
        const topFactor = this.findTopFactor(evaluation.factors);
        if (topFactor) fnCount.set(topFactor, (fnCount.get(topFactor) ?? 0) + 1);
      }
    }

    // Adjust weights for frequent false positives
    for (const [factor, count] of fpCount) {
      if (count < 2) continue; // Need at least 2 occurrences
      const oldWeight = currentWeights[factor] ?? 1.0;
      const newWeight = clampWeight(oldWeight * FALSE_POSITIVE_MULTIPLIER);
      if (newWeight !== oldWeight) {
        currentWeights[factor] = newWeight;
        adjustments.push({ factor, oldWeight, newWeight, reason: "false_positive" });
      }
    }

    // Adjust weights for frequent false negatives
    for (const [factor, count] of fnCount) {
      if (count < 2) continue;
      const oldWeight = currentWeights[factor] ?? 1.0;
      const newWeight = clampWeight(oldWeight * FALSE_NEGATIVE_MULTIPLIER);
      if (newWeight !== oldWeight) {
        currentWeights[factor] = newWeight;
        adjustments.push({ factor, oldWeight, newWeight, reason: "false_negative" });
      }
    }

    // Save adjusted weights
    if (adjustments.length > 0) {
      this.saveWeights(currentWeights);
      this.emitter?.emit("trigger.weights.adjusted", {
        adjustments,
        timestamp: Date.now(),
      });
    }

    return adjustments;
  }

  /** Load current factor weights from KV store. */
  loadWeights(): Record<string, number> {
    if (!this.kvStore) return {};
    try {
      const raw = this.kvStore.get(WEIGHTS_KV_KEY);
      if (!raw) return {};
      return JSON.parse(raw) as Record<string, number>;
    } catch {
      return {};
    }
  }

  /** Save factor weights to KV store. */
  private saveWeights(weights: Record<string, number>): void {
    this.kvStore?.set(WEIGHTS_KV_KEY, JSON.stringify(weights));
  }

  /**
   * Reset all weights to defaults (1.0).
   * Emits trigger.weights.reset event for audit trail.
   */
  resetWeights(): void {
    this.kvStore?.delete(WEIGHTS_KV_KEY);
    this.emitter?.emit("trigger.weights.reset", { timestamp: Date.now() });
  }

  /**
   * Apply learned weights to a factor's contribution score.
   * Returns the adjusted score: original × weight (default 1.0 if no learned weight).
   */
  applyWeight(factor: string, score: number): number {
    const weights = this.loadWeights();
    const weight = weights[factor] ?? 1.0;
    return score * weight;
  }

  /** Find the highest contributing factor in an evaluation. */
  private findTopFactor(factors: Record<string, number>): string | null {
    let topFactor: string | null = null;
    let topScore = -Infinity;
    for (const [factor, score] of Object.entries(factors)) {
      if (score > topScore) {
        topScore = score;
        topFactor = factor;
      }
    }
    return topFactor;
  }
}

// ── Helpers ─────────────────────────────────────────

function clampWeight(w: number): number {
  return Math.round(Math.max(WEIGHT_LOWER_BOUND, Math.min(WEIGHT_UPPER_BOUND, w)) * 1000) / 1000;
}
