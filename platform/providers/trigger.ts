/**
 * Consensus Trigger — decides whether to run simple or deliberative audit.
 *
 * Evaluates 12 factors (6 base + 4 domain/quality + 2 FDE learning) to determine
 * if full deliberative consensus is needed.
 * Maps to complexity tiers: T1 (skip), T2 (simple), T3 (deliberative).
 */

import type { DetectedDomains } from "./domain-detect.js";

export type ConsensusMode = "skip" | "simple" | "deliberative";

export interface TriggerContext {
  /** Number of changed files. */
  changedFiles: number;
  /** Whether any security-sensitive files are changed. */
  securitySensitive: boolean;
  /** Number of previous rejections for this scope. */
  priorRejections: number;
  /** Whether the change modifies public API surface. */
  apiSurfaceChanged: boolean;
  /** Whether cross-layer contracts are affected (BE↔FE). */
  crossLayerChange: boolean;
  /** Whether the change is a rollback or revert. */
  isRevert: boolean;
  /** Detected specialist domains (optional — enhances tier routing). */
  domains?: DetectedDomains;
  /** Whether a plan document exists for this change scope. */
  hasPlanDoc?: boolean;
  /** Current fitness score (0.0-1.0). Low fitness → higher tier. */
  fitnessScore?: number;
  /** Blast radius ratio (0.0-1.0). High ratio → higher tier. */
  blastRadius?: number;
  /** Number of changes to the same files in recent history. Higher = hot spot. */
  changeVelocity?: number;
  /** Past stagnation pattern count for similar file patterns. */
  stagnationHistory?: number;
}

export interface TriggerResult {
  mode: ConsensusMode;
  tier: "T1" | "T2" | "T3";
  reasons: string[];
  score: number;
  /** Domains that were detected (empty if not provided). */
  activeDomains: (keyof DetectedDomains)[];
  /** True when T3 audit has no plan doc — enforcement may block. */
  requiresPlan: boolean;
  /** Per-factor contribution scores (for learning feedback loop). */
  factors: Record<string, number>;
}

/** Optional learned weights to apply to factor scores. */
export type LearnedWeights = Record<string, number>;

/**
 * Determine consensus mode based on change context.
 *
 * Scoring:
 *   0.0 - 0.3  → T1 skip (micro change, no audit needed)
 *   0.3 - 0.7  → T2 simple (single auditor)
 *   0.7 - 1.0  → T3 deliberative (3-role protocol)
 */
export function evaluateTrigger(ctx: TriggerContext, learnedWeights?: LearnedWeights): TriggerResult {
  const reasons: string[] = [];
  const factors: Record<string, number> = {};
  let score = 0;

  const w = (factor: string, base: number): number => {
    const weight = learnedWeights?.[factor] ?? 1.0;
    const adjusted = base * weight;
    factors[factor] = adjusted;
    return adjusted;
  };

  // 1. File count (0-0.3)
  const fileCount = typeof ctx.changedFiles === "number" ? ctx.changedFiles : 0;
  if (fileCount <= 2) {
    score += w("fileCount", 0.1);
  } else if (fileCount <= 8) {
    score += w("fileCount", 0.25);
    reasons.push(`${fileCount} files changed`);
  } else {
    score += w("fileCount", 0.3);
    reasons.push(`${fileCount} files changed (large scope)`);
  }

  // 2. Security sensitivity (0-0.25)
  if (ctx.securitySensitive) {
    score += w("security", 0.25);
    reasons.push("security-sensitive files modified");
  }

  // 3. Prior rejections (0-0.2)
  if (ctx.priorRejections >= 2) {
    score += w("priorRejections", 0.2);
    reasons.push(`${ctx.priorRejections} prior rejections (repeated failure)`);
  } else if (ctx.priorRejections === 1) {
    score += w("priorRejections", 0.1);
    reasons.push("1 prior rejection");
  }

  // 4. API surface change (0-0.15)
  if (ctx.apiSurfaceChanged) {
    score += w("apiSurface", 0.15);
    reasons.push("public API surface modified");
  }

  // 5. Cross-layer contract (0-0.1)
  if (ctx.crossLayerChange) {
    score += w("crossLayer", 0.1);
    reasons.push("cross-layer contract affected");
  }

  // 6. Revert discount (-0.3)
  if (ctx.isRevert) {
    score = Math.max(0, score - 0.3);
    reasons.push("revert (reduced risk)");
  }

  // 7. Domain-aware scoring (optional, 0-0.15 total)
  const activeDomains: (keyof DetectedDomains)[] = [];
  if (ctx.domains) {
    // High-risk domains push toward higher tiers
    const HIGH_RISK_DOMAINS: (keyof DetectedDomains)[] = ["migration", "compliance", "concurrency", "security"];
    const MID_RISK_DOMAINS: (keyof DetectedDomains)[] = ["performance", "accessibility", "infrastructure"];

    for (const domain of HIGH_RISK_DOMAINS) {
      if (ctx.domains[domain]) {
        score += 0.1;
        activeDomains.push(domain);
        reasons.push(`${domain} domain affected (high-risk)`);
      }
    }
    for (const domain of MID_RISK_DOMAINS) {
      if (ctx.domains[domain]) {
        score += 0.05;
        activeDomains.push(domain);
        reasons.push(`${domain} domain affected`);
      }
    }
    // Low-risk domains: observability, documentation, i18n — detected but don't increase score
    const LOW_RISK_DOMAINS: (keyof DetectedDomains)[] = ["observability", "documentation", "i18n"];
    for (const domain of LOW_RISK_DOMAINS) {
      if (ctx.domains[domain]) {
        activeDomains.push(domain);
      }
    }
  }

  // 8. Plan coverage — large changes without plan docs push toward T3
  if (ctx.changedFiles > 5 && ctx.hasPlanDoc === false) {
    score += 0.1;
    reasons.push("large change without plan documentation");
  }

  // 9. Fitness score — low fitness pushes toward stricter audit (0-0.15)
  if (ctx.fitnessScore !== undefined && ctx.fitnessScore < 0.5) {
    const fitnessContribution = w("fitness", 0.15 * (1 - ctx.fitnessScore / 0.5));
    score += fitnessContribution;
    reasons.push(`low fitness score (${ctx.fitnessScore.toFixed(2)}) — stricter audit`);
  }

  // 10. Blast radius — wide impact pushes toward stricter audit (0-0.15)
  if (ctx.blastRadius !== undefined && ctx.blastRadius > 0.1) {
    const blastContribution = w("blastRadius", Math.min(0.15, ctx.blastRadius * 0.3));
    score += blastContribution;
    reasons.push(`blast radius ${(ctx.blastRadius * 100).toFixed(0)}% — wide impact`);
  }

  // 11. Change velocity — frequently changed files are higher risk (0-0.1)
  if (ctx.changeVelocity !== undefined && ctx.changeVelocity >= 3) {
    const velocityContribution = w("changeVelocity", Math.min(0.1, ctx.changeVelocity * 0.02));
    score += velocityContribution;
    reasons.push(`change velocity ${ctx.changeVelocity} (hot spot)`);
  }

  // 12. Stagnation history — past stagnation on similar files → auto-escalate (0-0.15)
  if (ctx.stagnationHistory !== undefined && ctx.stagnationHistory > 0) {
    const stagnationContribution = w("stagnation", Math.min(0.15, ctx.stagnationHistory * 0.05));
    score += stagnationContribution;
    reasons.push(`${ctx.stagnationHistory} past stagnation events on similar files`);
  }

  // 13. High-risk factor interactions — multiplicative escalation
  // When multiple high-risk signals co-occur, the combined risk is greater than the sum.
  const interactions: Array<{ factors: boolean[]; multiplier: number; label: string }> = [
    {
      // Security + wide blast radius = potential supply-chain-level risk
      factors: [ctx.securitySensitive, (ctx.blastRadius ?? 0) > 0.2],
      multiplier: 1.3,
      label: "security × blast-radius",
    },
    {
      // Security + cross-layer = attack surface spanning layers
      factors: [ctx.securitySensitive, ctx.crossLayerChange],
      multiplier: 1.2,
      label: "security × cross-layer",
    },
    {
      // Cross-layer + API change = contract breakage risk
      factors: [ctx.crossLayerChange, ctx.apiSurfaceChanged],
      multiplier: 1.15,
      label: "cross-layer × API-surface",
    },
    {
      // Prior rejections + stagnation = systemic problem
      factors: [ctx.priorRejections >= 2, (ctx.stagnationHistory ?? 0) > 0],
      multiplier: 1.25,
      label: "repeated-rejection × stagnation",
    },
  ];

  let appliedMultiplier = 1.0;
  for (const { factors, multiplier, label } of interactions) {
    if (factors.every(Boolean)) {
      appliedMultiplier = Math.max(appliedMultiplier, multiplier);
      reasons.push(`${label} interaction (×${multiplier})`);
    }
  }
  if (appliedMultiplier > 1.0) {
    score *= appliedMultiplier;
  }

  // Clamp
  score = Math.min(1, Math.max(0, score));

  // Tier mapping
  let mode: ConsensusMode;
  let tier: "T1" | "T2" | "T3";

  if (score < 0.3) {
    mode = "skip";
    tier = "T1";
  } else if (score < 0.7) {
    mode = "simple";
    tier = "T2";
  } else {
    mode = "deliberative";
    tier = "T3";
  }

  const requiresPlan = tier === "T3" && ctx.hasPlanDoc === false;

  return { mode, tier, reasons, score, activeDomains, requiresPlan, factors };
}
