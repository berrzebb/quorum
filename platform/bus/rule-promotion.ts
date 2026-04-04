/**
 * Rule Promotion Engine — SOFT→HARD auto-promotion + Meta Loop.
 *
 * PRD § FR-20: candidate→SOFT (3 violations), SOFT→HARD (5 violations).
 * PRD § FR-21: 30-day effectiveness evaluation (Meta Loop).
 *
 * @module bus/rule-promotion
 */

import type { RuleRegistry, Rule, RuleLevel } from "./rule-registry.js";

// ── Types ────────────────────────────────────────

export interface PromotionResult {
  ruleId: string;
  pattern: string;
  from: RuleLevel;
  to: RuleLevel;
  violations: number;
}

export interface EvaluationResult {
  ruleId: string;
  pattern: string;
  level: RuleLevel;
  action: "verified" | "maintain" | "archived" | "escalate";
  reason: string;
}

export interface PromotionConfig {
  softThreshold?: number;   // default: 3
  hardThreshold?: number;   // default: 5
  metaLoopDays?: number;    // default: 30
}

// ── Promotion ────────────────────────────────────

const DEFAULT_SOFT_THRESHOLD = 3;
const DEFAULT_HARD_THRESHOLD = 5;
const DEFAULT_META_LOOP_DAYS = 30;

/**
 * Check all rules for pending promotions.
 * candidate → 3 violations → SOFT
 * SOFT → 5 violations → HARD
 */
export function checkPromotions(
  registry: RuleRegistry,
  config: PromotionConfig = {},
): PromotionResult[] {
  const softThreshold = config.softThreshold ?? DEFAULT_SOFT_THRESHOLD;
  const hardThreshold = config.hardThreshold ?? DEFAULT_HARD_THRESHOLD;
  const results: PromotionResult[] = [];

  // Check candidates → SOFT
  const candidates = registry.getRules({ level: "candidate", minViolations: softThreshold });
  for (const rule of candidates) {
    registry.promoteRule(rule.id, "soft");
    results.push({
      ruleId: rule.id,
      pattern: rule.pattern,
      from: "candidate",
      to: "soft",
      violations: rule.violationCount,
    });
  }

  // Check SOFT → HARD
  const softRules = registry.getRules({ level: "soft", minViolations: hardThreshold });
  for (const rule of softRules) {
    registry.promoteRule(rule.id, "hard");
    results.push({
      ruleId: rule.id,
      pattern: rule.pattern,
      from: "soft",
      to: "hard",
      violations: rule.violationCount,
    });
  }

  return results;
}

/**
 * Meta Loop: evaluate rule effectiveness after 30 days.
 * PRD § FR-21.
 */
export function evaluateEffectiveness(
  registry: RuleRegistry,
  config: PromotionConfig = {},
): EvaluationResult[] {
  const metaDays = config.metaLoopDays ?? DEFAULT_META_LOOP_DAYS;
  const cutoff = Date.now() - metaDays * 86400_000;
  const results: EvaluationResult[] = [];

  // Only evaluate promoted rules (soft/hard) with promotedAt > 30 days ago
  const promoted = [
    ...registry.getRules({ level: "soft" }),
    ...registry.getRules({ level: "hard" }),
  ].filter(r => r.promotedAt != null && r.promotedAt < cutoff);

  for (const rule of promoted) {
    const violationsSincePromotion = rule.lastViolated != null && rule.lastViolated > (rule.promotedAt ?? 0);

    if (!violationsSincePromotion) {
      // No violations since promotion → rule is effective
      if (rule.violationCount === 0) {
        // Never triggered at all → might be dead rule
        registry.promoteRule(rule.id, "archived");
        results.push({
          ruleId: rule.id, pattern: rule.pattern, level: rule.level,
          action: "archived", reason: "rule never triggered (0 violations total)",
        });
      } else {
        registry.promoteRule(rule.id, "verified");
        results.push({
          ruleId: rule.id, pattern: rule.pattern, level: rule.level,
          action: "verified", reason: "no violations since promotion — rule effective",
        });
      }
    } else {
      // Violations occurred after promotion
      results.push({
        ruleId: rule.id, pattern: rule.pattern, level: rule.level,
        action: rule.level === "soft" ? "escalate" : "maintain",
        reason: `violations after promotion — ${rule.level === "soft" ? "consider escalating to HARD" : "maintaining HARD level"}`,
      });
    }
  }

  return results;
}

/**
 * Demote a rule (manual override).
 */
export function demoteRule(registry: RuleRegistry, ruleId: string, to: RuleLevel = "candidate"): void {
  registry.promoteRule(ruleId, to);
}
