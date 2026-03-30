/**
 * Model tier routing — WB size × domain risk → model selection.
 *
 * Pure function. No file I/O, no provider calls.
 * Uses detectDomains from providers/domain-detect for domain analysis.
 */

import type { WBSize } from "../planning/types.js";
import { detectDomains as detectDomainsProvider } from "../../providers/domain-detect.js";

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

  const domains = detectDomainsFromFiles(targetFiles);
  const hasHighRisk = domains.some(d => HIGH_RISK_DOMAINS.has(d));

  switch (size) {
    case "XS": return { provider: "claude", model: hasHighRisk ? "sonnet" : "haiku", domains };
    case "S":  return { provider: "claude", model: hasHighRisk ? "opus" : "sonnet", domains };
    case "M":  return { provider: "claude", model: "opus", domains };
    default:   return { provider: "claude", model: hasHighRisk ? "opus" : undefined, domains };
  }
}

/** Extract active domain names from file paths using the canonical detectDomains. */
function detectDomainsFromFiles(targetFiles?: string[]): string[] {
  if (!targetFiles || targetFiles.length === 0) return [];
  try {
    const result = detectDomainsProvider(targetFiles);
    return (Object.entries(result.domains) as [string, boolean][])
      .filter(([, active]) => active)
      .map(([name]) => name);
  } catch (err) {
    console.error(`[model-routing] domain detection failed: ${(err as Error).message}`);
    return [];
  }
}
