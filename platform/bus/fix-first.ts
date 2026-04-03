/**
 * Fix-First Heuristic — auto-fix low-severity findings without human review.
 *
 * Severity → Action mapping:
 * - info, low → auto-fix (fixer agent called automatically)
 * - medium → review (human review required)
 * - high, critical → block (immediate rejection)
 *
 * @module bus/fix-first
 */

// ── Types ───────────────────────────────────────────

/** Action determined by severity classification. */
export type FixAction = "auto-fix" | "review" | "block";

/** A finding with at least a severity field. */
export interface Finding {
  severity: string;
  file?: string;
  line?: number;
  message?: string;
  [key: string]: unknown;
}

/** Options for auto-fix dispatch. */
export interface FixFirstOptions {
  /** Maximum number of auto-fixes per batch. Default: 5. */
  maxAutoFixes: number;
  /** Dry run — classify only, no fixer invocation. */
  dryRun: boolean;
  /** Provider for fixer agent. */
  provider?: string;
  /** Custom severity → action mapping override. */
  severityMap?: Record<string, FixAction>;
}

/** Result of a single auto-fix attempt. */
export interface FixResult {
  finding: Finding;
  action: "fixed" | "skipped" | "failed" | "promoted";
  detail?: string;
}

/** Classified findings grouped by action. */
export interface ClassifiedFindings {
  autoFixable: Finding[];
  reviewRequired: Finding[];
  blocking: Finding[];
}

/** Fixer function signature (injected dependency). */
export type FixerFunction = (finding: Finding, provider?: string) => Promise<boolean>;

// ── Default Config ──────────────────────────────────

export const DEFAULT_FIX_FIRST_OPTIONS: FixFirstOptions = {
  maxAutoFixes: 5,
  dryRun: false,
};

// ── Severity → Action Mapping ───────────────────────

const DEFAULT_SEVERITY_MAP: Record<string, FixAction> = {
  info: "auto-fix",
  low: "auto-fix",
  medium: "review",
  high: "block",
  critical: "block",
};

// ── Classification ──────────────────────────────────

/**
 * Classify a single finding's severity into an action.
 *
 * Unknown severities → block (fail-safe).
 */
export function classifyFinding(
  finding: Finding,
  severityMap?: Record<string, FixAction>,
): FixAction {
  const map = severityMap ?? DEFAULT_SEVERITY_MAP;
  return map[finding.severity] ?? "block";
}

/**
 * Classify an array of findings into 3 groups.
 *
 * Invariant: autoFixable + reviewRequired + blocking = original array.
 */
export function classifyFindings(
  findings: Finding[],
  severityMap?: Record<string, FixAction>,
): ClassifiedFindings {
  const autoFixable: Finding[] = [];
  const reviewRequired: Finding[] = [];
  const blocking: Finding[] = [];

  for (const f of findings) {
    const action = classifyFinding(f, severityMap);
    switch (action) {
      case "auto-fix": autoFixable.push(f); break;
      case "review": reviewRequired.push(f); break;
      case "block": blocking.push(f); break;
    }
  }

  return { autoFixable, reviewRequired, blocking };
}

// ── Auto-Fix Dispatch ───────────────────────────────

/**
 * Dispatch auto-fix for eligible findings.
 *
 * - Classifies findings
 * - Limits to maxAutoFixes (excess promoted to review)
 * - Calls fixer function for each auto-fixable finding
 * - Returns per-finding result
 */
export async function dispatchAutoFix(
  findings: Finding[],
  fixer: FixerFunction,
  options: Partial<FixFirstOptions> = {},
): Promise<FixResult[]> {
  const opts: FixFirstOptions = { ...DEFAULT_FIX_FIRST_OPTIONS, ...options };
  const { autoFixable, reviewRequired, blocking } = classifyFindings(findings, opts.severityMap);
  const results: FixResult[] = [];

  // Blocking findings → skipped (handled by caller)
  for (const f of blocking) {
    results.push({ finding: f, action: "skipped", detail: "blocking severity" });
  }

  // Review findings → skipped
  for (const f of reviewRequired) {
    results.push({ finding: f, action: "skipped", detail: "review required" });
  }

  // Promote excess auto-fixable to review
  const toFix = autoFixable.slice(0, opts.maxAutoFixes);
  const promoted = autoFixable.slice(opts.maxAutoFixes);

  for (const f of promoted) {
    results.push({ finding: f, action: "promoted", detail: `exceeded maxAutoFixes (${opts.maxAutoFixes})` });
  }

  // Dry run: report classification only
  if (opts.dryRun) {
    for (const f of toFix) {
      results.push({ finding: f, action: "skipped", detail: "dry run" });
    }
    return results;
  }

  // Invoke fixer for each auto-fixable finding
  for (const f of toFix) {
    try {
      const success = await fixer(f, opts.provider);
      results.push({
        finding: f,
        action: success ? "fixed" : "failed",
        detail: success ? "auto-fixed" : "fixer returned false",
      });
    } catch (err) {
      results.push({
        finding: f,
        action: "failed",
        detail: `fixer error: ${(err as Error).message}`,
      });
    }
  }

  return results;
}
