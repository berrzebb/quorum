/**
 * Model tier routing — WB size × domain risk → model selection.
 *
 * Pure function. No file I/O, no provider calls.
 */

import type { WBSize } from "../../cli/commands/orchestrate/shared.js";

// ── Domain risk tiers ────────────────────────
const HIGH_RISK_DOMAINS = new Set(["security", "concurrency", "migration", "compliance"]);
const MEDIUM_RISK_DOMAINS = new Set(["performance", "infrastructure", "accessibility"]);

export { HIGH_RISK_DOMAINS, MEDIUM_RISK_DOMAINS };

export interface ModelSelection {
  provider: string;
  model?: string;
  domains: string[];
}

/**
 * Select model tier based on WB size × domain complexity.
 *
 * Matrix:
 *   XS + low-risk    → haiku    (trivial task, simple domain)
 *   XS + high-risk   → sonnet   (small task, but needs careful reasoning)
 *   S  + low-risk    → sonnet   (medium task, simple domain)
 *   S  + high-risk   → opus     (medium task, dangerous domain)
 *   M  + any         → opus     (large task always gets full power)
 */
export function selectModelForTask(
  baseProvider: string, size?: WBSize, targetFiles?: string[],
): ModelSelection {
  if (baseProvider !== "claude") return { provider: baseProvider, domains: [] };

  const domains = detectDomains(targetFiles);
  const hasHighRisk = domains.some(d => HIGH_RISK_DOMAINS.has(d));
  const hasMediumRisk = domains.some(d => MEDIUM_RISK_DOMAINS.has(d));

  switch (size) {
    case "XS": return { provider: "claude", model: hasHighRisk ? "sonnet" : "haiku", domains };
    case "S":  return { provider: "claude", model: hasHighRisk ? "opus" : hasMediumRisk ? "sonnet" : "sonnet", domains };
    case "M":  return { provider: "claude", model: "opus", domains };
    default:   return { provider: "claude", model: hasHighRisk ? "opus" : undefined, domains };
  }
}

/** Lightweight domain detection from file path patterns (no imports needed). */
function detectDomains(targetFiles?: string[]): string[] {
  if (!targetFiles || targetFiles.length === 0) return [];
  const domains: string[] = [];
  try {
    for (const f of targetFiles) {
      const fl = f.toLowerCase();
      if (/auth|login|password|token|secret|crypt|csrf|xss|sanitiz/i.test(fl)) domains.push("security");
      if (/migration|migrate|schema|seed/i.test(fl)) domains.push("migration");
      if (/mutex|lock|worker|thread|concurrent|atomic|channel/i.test(fl)) domains.push("concurrency");
      if (/license|gdpr|ccpa|compliance|pii|privacy/i.test(fl)) domains.push("compliance");
      if (/perf|benchmark|cache|optimi/i.test(fl)) domains.push("performance");
      if (/docker|ci|cd|deploy|infra|terraform|k8s|helm/i.test(fl)) domains.push("infrastructure");
      if (/a11y|aria|wcag|accessib/i.test(fl)) domains.push("accessibility");
    }
  } catch { /* fail-open */ }
  return [...new Set(domains)];
}
