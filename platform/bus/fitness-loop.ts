/**
 * Fitness Loop — autonomous quality gate inspired by Karpathy's autoresearch.
 *
 * Three gate decisions:
 *   - **proceed**: score maintained or improved → continue to LLM audit
 *   - **self-correct**: score dropped slightly → warn agent, continue
 *   - **auto-reject**: score dropped significantly → skip LLM audit (save cost)
 *
 * Stores baseline and history in EventStore's kv_state table.
 */

import type { EventStore } from "./store.js";
import type { FitnessScore, FitnessDelta } from "./events.js";
import { computeDelta, computeTrend } from "./fitness.js";

// ── Types ────────────────────────────────────────────

export type GateDecision = "proceed" | "self-correct" | "auto-reject";

export interface FitnessGateResult {
  decision: GateDecision;
  current: number;
  baseline: number;
  delta: number;
  reason: string;
  details?: FitnessDelta;
}

export interface FitnessTrend {
  movingAverage: number;
  slope: number;
  windowSize: number;
  dataPoints: number;
}

export interface FitnessLoopConfig {
  /** Delta threshold below which auto-reject fires (default: -0.15). */
  rejectThreshold?: number;
  /** Delta threshold below which self-correct fires (default: -0.05). */
  warnThreshold?: number;
  /** Minimum total score to proceed (default: 0.3). */
  minScore?: number;
  /** Window size for trend calculation (default: 5). */
  trendWindow?: number;
}

// ── KV keys ──────────────────────────────────────────

const KV_BASELINE = "fitness.baseline";
const KV_HISTORY = "fitness.history";

// ── FitnessLoop ──────────────────────────────────────

export class FitnessLoop {
  private store: EventStore | null;
  private config: Required<FitnessLoopConfig>;

  constructor(store: EventStore | null, config?: FitnessLoopConfig) {
    this.store = store;
    this.config = {
      rejectThreshold: config?.rejectThreshold ?? -0.15,
      warnThreshold: config?.warnThreshold ?? -0.05,
      minScore: config?.minScore ?? 0.3,
      trendWindow: config?.trendWindow ?? 5,
    };
  }

  /** Get the stored baseline score, or null if none. */
  getBaseline(): FitnessScore | null {
    if (!this.store) return null;
    try {
      return this.store.getKV(KV_BASELINE) as FitnessScore | null;
    } catch (err) {
      console.warn(`[fitness-loop] getBaseline failed: ${(err as Error).message}`);
      return null;
    }
  }

  /** Set the baseline to the given score. */
  setBaseline(score: FitnessScore): void {
    if (!this.store) return;
    try {
      this.store.setKV(KV_BASELINE, score);
    } catch (err) { console.warn(`[fitness-loop] setBaseline failed: ${(err as Error).message}`); }
  }

  /**
   * Evaluate a fitness score against the baseline.
   *
   * If no baseline exists, the current score becomes the baseline and we proceed.
   */
  evaluate(current: FitnessScore): FitnessGateResult {
    const baseline = this.getBaseline();

    // First evaluation: establish baseline
    if (!baseline) {
      this.setBaseline(current);
      this.record(current);
      return {
        decision: "proceed",
        current: current.total,
        baseline: current.total,
        delta: 0,
        reason: "First evaluation — baseline established",
      };
    }

    const delta = computeDelta(baseline, current);
    const d = delta.delta;

    // Absolute floor: score too low regardless of delta
    if (current.total < this.config.minScore) {
      this.record(current);
      return {
        decision: "auto-reject",
        current: current.total,
        baseline: baseline.total,
        delta: d,
        reason: `Score ${current.total} below minimum threshold ${this.config.minScore}`,
        details: delta,
      };
    }

    // Significant regression: auto-reject
    if (d <= this.config.rejectThreshold) {
      this.record(current);
      return {
        decision: "auto-reject",
        current: current.total,
        baseline: baseline.total,
        delta: d,
        reason: `Score dropped ${d.toFixed(3)} (threshold: ${this.config.rejectThreshold})`,
        details: delta,
      };
    }

    // Mild regression: self-correct
    if (d <= this.config.warnThreshold) {
      this.record(current);
      return {
        decision: "self-correct",
        current: current.total,
        baseline: baseline.total,
        delta: d,
        reason: `Score dropped ${d.toFixed(3)} — consider reviewing recent changes`,
        details: delta,
      };
    }

    // Stable or improved: proceed and update baseline if improved
    if (d > 0) {
      this.setBaseline(current);
    }
    this.record(current);

    return {
      decision: "proceed",
      current: current.total,
      baseline: baseline.total,
      delta: d,
      reason: d > 0
        ? `Score improved by ${d.toFixed(3)}`
        : "Score maintained",
      details: delta,
    };
  }

  /** Record a score in the history array. */
  record(score: FitnessScore): void {
    if (!this.store) return;
    try {
      const history = (this.store.getKV(KV_HISTORY) as number[]) ?? [];
      history.push(score.total);
      // Keep last 50 data points
      if (history.length > 50) history.splice(0, history.length - 50);
      this.store.setKV(KV_HISTORY, history);
    } catch (err) { console.warn(`[fitness-loop] record failed: ${(err as Error).message}`); }
  }

  /** Compute trend from stored history. */
  getTrend(): FitnessTrend {
    const history = this.getHistory();
    const { movingAverage, slope } = computeTrend(history, this.config.trendWindow);
    return {
      movingAverage,
      slope,
      windowSize: this.config.trendWindow,
      dataPoints: history.length,
    };
  }

  /** Get raw history array. */
  getHistory(): number[] {
    if (!this.store) return [];
    try {
      return (this.store.getKV(KV_HISTORY) as number[]) ?? [];
    } catch (err) {
      console.warn(`[fitness-loop] getHistory failed: ${(err as Error).message}`);
      return [];
    }
  }

  /** Reset baseline and history (e.g., after major refactor). */
  reset(): void {
    if (!this.store) return;
    try {
      this.store.setKV(KV_BASELINE, null);
      this.store.setKV(KV_HISTORY, []);
    } catch (err) { console.warn(`[fitness-loop] reset failed: ${(err as Error).message}`); }
  }
}
