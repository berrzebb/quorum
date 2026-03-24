/**
 * Normal Form Convergence Tracking — measures structural conformance by stage.
 *
 * Tracks the convergence path: Raw Output → Autofix → Manual Fix → Normal Form.
 * Regardless of starting quality, the parliamentary protocol drives all
 * implementations toward 100% conformance (Normal Form).
 *
 * Key insight: quorum's value is NOT improving Raw Output quality —
 * it's owning the structure that converges ANY Raw Output to Normal Form.
 *
 * impl(A, law) = impl(B, law) = impl(C, law)
 */

import type { EventStore } from "./store.js";
import { AUDIT_VERDICT, type ProviderKind, type AuditVerdictPayload, type AuditVerdict } from "./events.js";
import type { FitnessScore } from "./fitness.js";
import type { ConfluenceResult } from "./confluence.js";

// ── Types ────────────────────────────────────

export type ConformanceStage = "raw-output" | "autofix" | "manual-fix" | "normal-form";

export interface StageConformance {
  stage: ConformanceStage;
  /** Structural conformance percentage (0-100). */
  conformance: number;
  /** Number of audit rounds at this stage. */
  rounds: number;
  /** Timestamp when this stage was reached. */
  reachedAt: number;
}

export interface ProviderConvergence {
  provider: ProviderKind;
  stages: StageConformance[];
  /** Current stage. */
  currentStage: ConformanceStage;
  /** Whether Normal Form (100%) has been reached. */
  normalFormReached: boolean;
  /** Total rounds from raw output to current stage. */
  totalRounds: number;
  /** Whether a regression was detected (stage moved backward). */
  regressed: boolean;
  /** Previous stage before regression (null if no regression). */
  regressionFrom?: ConformanceStage;
}

export interface ConvergenceReport {
  providers: ProviderConvergence[];
  /** Whether all providers have reached Normal Form. */
  allConverged: boolean;
  /** Average rounds to Normal Form (only for providers that reached it). */
  avgRoundsToNormalForm: number | null;
  timestamp: number;
}

export const STAGE_ORDER: ConformanceStage[] = ["raw-output", "autofix", "manual-fix", "normal-form"];

// ── Stage Classification ────────────────────

/**
 * Classify the current conformance stage based on audit history.
 *
 * - Raw Output: first submission, no audit yet
 * - Autofix: audit found issues, automated corrections applied (1-2 rounds)
 * - Manual Fix: multiple rounds of corrections (3+ rounds)
 * - Normal Form: audit approved + confluence verified
 */
export function classifyStage(
  auditRounds: number,
  lastVerdict: AuditVerdict | null,
  confluencePassed: boolean,
): ConformanceStage {
  if (auditRounds === 0) return "raw-output";
  if (lastVerdict === AUDIT_VERDICT.APPROVED && confluencePassed) return "normal-form";
  if (auditRounds <= 2) return "autofix";
  return "manual-fix";
}

/**
 * Compute structural conformance percentage from fitness + audit signals.
 *
 * Conformance = weighted combination of:
 * - Fitness score (40%): code quality metrics
 * - Audit pass rate (40%): ratio of approved verdicts
 * - Confluence score (20%): integration integrity
 */
export function computeConformance(
  fitnessTotal: number,
  auditPassRate: number,
  confluencePassRate: number,
): number {
  const raw = fitnessTotal * 0.4 + auditPassRate * 0.4 + confluencePassRate * 0.2;
  return Math.round(raw * 10000) / 100; // percentage with 2 decimals
}

// ── Provider Tracking ───────────────────────

/**
 * Build convergence data for a specific provider from pre-filtered verdict events.
 * Accepts events directly to avoid redundant EventStore queries (N+1 fix).
 */
export function trackProviderConvergenceFromEvents(
  provider: ProviderKind,
  verdictEvents: Array<{ timestamp: number; payload: Record<string, unknown>; source: ProviderKind }>,
): ProviderConvergence {
  const stages: StageConformance[] = [];
  let approvedCount = 0;
  let totalRounds = verdictEvents.length;

  // Track stage transitions
  let currentRound = 0;
  let lastStage: ConformanceStage = "raw-output";
  let regressed = false;
  let regressionFrom: ConformanceStage | undefined;

  // Raw output stage (always exists)
  stages.push({
    stage: "raw-output",
    conformance: estimateRawConformance(verdictEvents),
    rounds: 0,
    reachedAt: verdictEvents[0]?.timestamp ?? Date.now(),
  });

  for (const e of verdictEvents) {
    currentRound++;
    const verdict = (e.payload as unknown as AuditVerdictPayload).verdict;
    if (verdict === AUDIT_VERDICT.APPROVED) approvedCount++;

    const passRate = approvedCount / currentRound;
    // Estimate conformance at each round
    const conformance = computeConformance(
      passRate * 0.8 + 0.2, // rough fitness proxy
      passRate,
      verdict === AUDIT_VERDICT.APPROVED ? 1 : 0,
    );

    const stage = classifyStage(currentRound, verdict, verdict === AUDIT_VERDICT.APPROVED);

    if (stage !== lastStage) {
      // Detect regression: stage moved backward
      if (STAGE_ORDER.indexOf(stage) < STAGE_ORDER.indexOf(lastStage)) {
        regressed = true;
        regressionFrom = lastStage;
      }
      stages.push({
        stage,
        conformance,
        rounds: currentRound,
        reachedAt: e.timestamp,
      });
      lastStage = stage;
    }
  }

  const currentStage = lastStage;
  const normalFormReached = currentStage === "normal-form";

  return {
    provider,
    stages,
    currentStage,
    normalFormReached,
    totalRounds,
    regressed,
    regressionFrom,
  };
}

/**
 * Build convergence data for a specific provider from EventStore.
 * Convenience wrapper that queries the store — use trackProviderConvergenceFromEvents
 * when you already have the events to avoid redundant queries.
 */
export function trackProviderConvergence(
  store: EventStore,
  provider: ProviderKind,
): ProviderConvergence {
  const verdictEvents = store.query({ eventType: "audit.verdict" })
    .filter(e => e.source === provider);
  return trackProviderConvergenceFromEvents(provider, verdictEvents);
}

/**
 * Generate a full convergence report across all providers.
 * Single query — groups by provider in JS to avoid N+1 store queries.
 */
export function generateConvergenceReport(store: EventStore): ConvergenceReport {
  // Single query: fetch all verdict events once, group by provider in memory
  const allEvents = store.query({ eventType: "audit.verdict" });
  const byProvider = new Map<ProviderKind, typeof allEvents>();
  for (const e of allEvents) {
    const arr = byProvider.get(e.source) ?? [];
    arr.push(e);
    byProvider.set(e.source, arr);
  }

  const convergences: ProviderConvergence[] = [];
  for (const [provider, events] of byProvider) {
    convergences.push(trackProviderConvergenceFromEvents(provider, events));
  }

  const convergedProviders = convergences.filter(c => c.normalFormReached);
  const allConverged = byProvider.size > 0 && convergedProviders.length === byProvider.size;
  const avgRoundsToNormalForm = convergedProviders.length > 0
    ? convergedProviders.reduce((sum, c) => sum + c.totalRounds, 0) / convergedProviders.length
    : null;

  return {
    providers: convergences,
    allConverged,
    avgRoundsToNormalForm,
    timestamp: Date.now(),
  };
}

// ── Helpers ──────────────────────────────────

/**
 * Estimate raw output conformance from first verdict.
 * If first verdict is approved → high raw conformance (~95%).
 * If changes_requested → estimate from rejection code count.
 */
function estimateRawConformance(
  verdictEvents: Array<{ payload: Record<string, unknown> }>,
): number {
  if (verdictEvents.length === 0) return 50; // unknown → assume 50%

  const first = verdictEvents[0]!.payload as unknown as AuditVerdictPayload;
  if (first.verdict === AUDIT_VERDICT.APPROVED) return 95;
  if (first.verdict === "infra_failure") return 50;

  // changes_requested: estimate from code count
  const codeCount = first.codes?.length ?? 0;
  return Math.max(20, 80 - codeCount * 10);
}
