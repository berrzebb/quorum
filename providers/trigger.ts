/**
 * Consensus Trigger — decides whether to run simple or deliberative audit.
 *
 * Evaluates 6 base conditions + optional domain signals to determine
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
}

export interface TriggerResult {
  mode: ConsensusMode;
  tier: "T1" | "T2" | "T3";
  reasons: string[];
  score: number;
  /** Domains that were detected (empty if not provided). */
  activeDomains: (keyof DetectedDomains)[];
}

/**
 * Determine consensus mode based on change context.
 *
 * Scoring:
 *   0.0 - 0.3  → T1 skip (micro change, no audit needed)
 *   0.3 - 0.7  → T2 simple (single auditor)
 *   0.7 - 1.0  → T3 deliberative (3-role protocol)
 */
export function evaluateTrigger(ctx: TriggerContext): TriggerResult {
  const reasons: string[] = [];
  let score = 0;

  // 1. File count (0-0.3)
  if (ctx.changedFiles <= 2) {
    score += 0.1;
  } else if (ctx.changedFiles <= 8) {
    score += 0.25;
    reasons.push(`${ctx.changedFiles} files changed`);
  } else {
    score += 0.3;
    reasons.push(`${ctx.changedFiles} files changed (large scope)`);
  }

  // 2. Security sensitivity (0-0.25)
  if (ctx.securitySensitive) {
    score += 0.25;
    reasons.push("security-sensitive files modified");
  }

  // 3. Prior rejections (0-0.2)
  if (ctx.priorRejections >= 2) {
    score += 0.2;
    reasons.push(`${ctx.priorRejections} prior rejections (repeated failure)`);
  } else if (ctx.priorRejections === 1) {
    score += 0.1;
    reasons.push("1 prior rejection");
  }

  // 4. API surface change (0-0.15)
  if (ctx.apiSurfaceChanged) {
    score += 0.15;
    reasons.push("public API surface modified");
  }

  // 5. Cross-layer contract (0-0.1)
  if (ctx.crossLayerChange) {
    score += 0.1;
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
    const HIGH_RISK_DOMAINS: (keyof DetectedDomains)[] = ["migration", "compliance", "concurrency"];
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

  return { mode, tier, reasons, score, activeDomains };
}
