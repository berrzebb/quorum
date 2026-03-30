/**
 * Fitness score queries — baseline, history, gate, trend, components.
 */

import type { EventStore } from "../../../platform/bus/store.js";

// ── Types ────────────────────────────────────

export interface FitnessInfo {
  /** Current baseline score (null if not yet established). */
  baseline: number | null;
  /** Latest computed score (null if no fitness events yet). */
  current: number | null;
  /** Latest gate decision. */
  gate: {
    decision: "proceed" | "self-correct" | "auto-reject";
    delta: number;
    reason: string;
  } | null;
  /** Score history (newest last, up to 50 entries). */
  history: number[];
  /** Trend: moving average and slope. */
  trend: {
    movingAverage: number;
    slope: number;
  } | null;
  /** Component breakdown of the latest score. */
  components: Record<string, { value: number; weight: number; label: string }> | null;
}

// ── Query ────────────────────────────────────

/**
 * Fitness score data from EventStore KV + recent events.
 */
export function queryFitnessInfo(store: EventStore): FitnessInfo {
  try {
    // Baseline and history from kv_state
    const baseline = store.getKV("fitness.baseline") as { total?: number; components?: Record<string, { value: number; weight: number; label: string }> } | null;
    const history = (store.getKV("fitness.history") as number[]) ?? [];

    // Latest gate decision from events
    const gateEvents = store.query({ eventType: "fitness.gate", limit: 1, descending: true });
    let gate: FitnessInfo["gate"] = null;
    if (gateEvents.length > 0) {
      const p = gateEvents[0].payload;
      gate = {
        decision: p.decision as "proceed" | "self-correct" | "auto-reject",
        delta: (p.delta as number) ?? 0,
        reason: (p.reason as string) ?? "",
      };
    }

    // Latest trend from events
    const trendEvents = store.query({ eventType: "fitness.trend", limit: 1, descending: true });
    let trend: FitnessInfo["trend"] = null;
    if (trendEvents.length > 0) {
      const p = trendEvents[0].payload;
      const ma = p.movingAverage as number;
      const sl = p.slope as number;
      trend = {
        movingAverage: Number.isFinite(ma) ? ma : 0,
        slope: Number.isFinite(sl) ? sl : 0,
      };
    }

    // Latest computed score from events
    const computeEvents = store.query({ eventType: "fitness.compute", limit: 1, descending: true });
    let current: number | null = null;
    let components: FitnessInfo["components"] = null;
    if (computeEvents.length > 0) {
      const score = computeEvents[0].payload.score as { total?: number; components?: Record<string, { value: number; weight: number; label: string }> } | undefined;
      if (score) {
        current = score.total ?? null;
        components = score.components ?? null;
      }
    }

    // If no compute events, use baseline for components
    if (!components && baseline?.components) {
      components = baseline.components;
    }

    return {
      baseline: baseline?.total ?? null,
      current: current ?? (history.length > 0 ? (Number.isFinite(history[history.length - 1]) ? history[history.length - 1] : null) : null),
      gate,
      history,
      trend,
      components,
    };
  } catch (err) {
    console.warn(`[fitness] queryFitnessInfo failed: ${(err as Error).message}`);
    return { baseline: null, current: null, gate: null, history: [], trend: null, components: null };
  }
}
