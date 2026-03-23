/**
 * Domain Router — conditional activation of specialist reviewers.
 *
 * Maps detected domains to the appropriate specialist tools and agents.
 * Only reviewers whose domain is affected AND whose minimum tier threshold
 * is met will be activated.
 *
 * Two layers per reviewer:
 * 1. Deterministic tool (always runs if domain is active — zero cost)
 * 2. LLM specialist agent (only runs at sufficient tier — costs API calls)
 */

import type { DetectedDomains } from "./domain-detect.js";

// ── Types ────────────────────────────────────

export type ReviewerTier = "T1" | "T2" | "T3";

export interface DomainReviewer {
  /** Which domain this reviewer covers. */
  domain: keyof DetectedDomains;
  /** Display name for logging and TUI. */
  displayName: string;
  /** Deterministic MCP tool to run (zero cost, always runs if domain active). */
  tool?: string;
  /** LLM agent persona name (loaded via AgentLoader, costs API calls). */
  agent?: string;
  /** Minimum tier required to activate the LLM agent. */
  agentMinTier: ReviewerTier;
  /** Rejection codes this reviewer can emit. */
  codes: string[];
}

export interface SelectedReviewer extends DomainReviewer {
  /** Whether the LLM agent should be activated (tier sufficient). */
  agentActive: boolean;
}

export interface ReviewerSelection {
  /** Selected reviewers with activation status. */
  reviewers: SelectedReviewer[];
  /** Tools to run (deterministic, zero cost). */
  tools: string[];
  /** Agents to invoke (LLM, conditional). */
  agents: string[];
  /** Summary for logging. */
  summary: string;
}

// ── Reviewer registry ────────────────────────

const DOMAIN_REVIEWERS: DomainReviewer[] = [
  {
    domain: "performance",
    displayName: "Performance Analyst",
    tool: "perf_scan",
    agent: "perf-analyst",
    agentMinTier: "T2",
    codes: ["perf-gap", "perf-regression"],
  },
  {
    domain: "migration",
    displayName: "Compatibility Reviewer",
    tool: "compat_check",
    agent: "compat-reviewer",
    agentMinTier: "T2",
    codes: ["compat-break", "migration-unsafe"],
  },
  {
    domain: "accessibility",
    displayName: "Accessibility Auditor",
    tool: "a11y_scan",
    agent: "a11y-auditor",
    agentMinTier: "T2",
    codes: ["a11y-gap", "a11y-regression"],
  },
  {
    domain: "compliance",
    displayName: "Compliance Officer",
    tool: "license_scan",
    agent: "compliance-officer",
    agentMinTier: "T2",
    codes: ["license-violation", "pii-exposure"],
  },
  {
    domain: "observability",
    displayName: "Observability Inspector",
    tool: "observability_check",
    agent: undefined,
    agentMinTier: "T3",
    codes: ["observability-gap"],
  },
  {
    domain: "documentation",
    displayName: "Documentation Steward",
    tool: "doc_coverage",
    agent: undefined,
    agentMinTier: "T3",
    codes: ["doc-stale", "doc-missing"],
  },
  {
    domain: "concurrency",
    displayName: "Concurrency Verifier",
    tool: undefined,
    agent: "concurrency-verifier",
    agentMinTier: "T3",
    codes: ["race-condition", "deadlock-risk"],
  },
  {
    domain: "i18n",
    displayName: "i18n Checker",
    tool: "i18n_validate",
    agent: undefined,
    agentMinTier: "T2",
    codes: ["i18n-parity", "i18n-hardcoded"],
  },
  {
    domain: "infrastructure",
    displayName: "Infrastructure Validator",
    tool: "infra_scan",
    agent: undefined,
    agentMinTier: "T2",
    codes: ["infra-unsafe", "infra-config"],
  },
];

// ── Tier comparison ──────────────────────────

const TIER_RANK: Record<ReviewerTier, number> = { T1: 1, T2: 2, T3: 3 };

function tierSufficient(current: ReviewerTier, required: ReviewerTier): boolean {
  return TIER_RANK[current] >= TIER_RANK[required];
}

// ── Selector ─────────────────────────────────

/**
 * Select specialist reviewers based on detected domains and current tier.
 *
 * @param domains - Domain detection result from detectDomains().
 * @param tier - Current audit tier (T1/T2/T3).
 * @returns Selection with tools to run and agents to invoke.
 */
export function selectReviewers(
  domains: DetectedDomains,
  tier: ReviewerTier,
): ReviewerSelection {
  const reviewers: SelectedReviewer[] = [];
  const tools: string[] = [];
  const agents: string[] = [];

  for (const reviewer of DOMAIN_REVIEWERS) {
    // Skip if domain is not affected
    if (!domains[reviewer.domain]) continue;

    const agentActive = reviewer.agent !== undefined && tierSufficient(tier, reviewer.agentMinTier);

    reviewers.push({ ...reviewer, agentActive });

    // Deterministic tool always runs if domain is active
    if (reviewer.tool) {
      tools.push(reviewer.tool);
    }

    // LLM agent only if tier is sufficient
    if (agentActive) {
      agents.push(reviewer.agent!);
    }
  }

  const summary = reviewers.length === 0
    ? "No specialist reviewers needed."
    : `${reviewers.length} reviewer(s): ${reviewers.map(r => r.displayName).join(", ")}` +
      ` | tools: ${tools.length} | agents: ${agents.length}`;

  return { reviewers, tools, agents, summary };
}

/**
 * Get all possible rejection codes from active reviewers.
 */
export function getActiveRejectionCodes(selection: ReviewerSelection): string[] {
  return selection.reviewers.flatMap(r => r.codes);
}

/**
 * Get the full domain reviewer registry (for status/help display).
 */
export function listDomainReviewers(): readonly DomainReviewer[] {
  return DOMAIN_REVIEWERS;
}
