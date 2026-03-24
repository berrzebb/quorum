/**
 * Confluence Verification — post-audit whole-system integrity check.
 *
 * After Design → Implementation → Audit, verifies 4 confluence points:
 * 1. Law ↔ Code: legislation matches implementation (Audit covers this)
 * 2. Part ↔ Whole: modules work together when integrated
 * 3. Intent ↔ Result: CPS problem is actually solved
 * 4. Law ↔ Law: different laws don't contradict each other
 *
 * Audit checks individual compliance (partial correctness).
 * Confluence checks system-wide coherence (total correctness).
 */

import type { EventStore } from "./store.js";
import type { CPS } from "./meeting-log.js";

// ── Types ────────────────────────────────────

export type ConfluenceCheckType = "law-code" | "part-whole" | "intent-result" | "law-law";

export interface ConfluenceCheck {
  type: ConfluenceCheckType;
  passed: boolean;
  detail: string;
  severity: "info" | "warning" | "error";
}

export interface ConfluenceResult {
  passed: boolean;
  checks: ConfluenceCheck[];
  /** Amendments that should be proposed for detected mismatches. */
  suggestedAmendments: SuggestedAmendment[];
  timestamp: number;
}

export interface SuggestedAmendment {
  target: "prd" | "design" | "wb" | "scope";
  change: string;
  justification: string;
  source: ConfluenceCheckType;
}

export interface ConfluenceInput {
  /** CPS that defined the original intent. */
  cps?: CPS;
  /** Whether integration tests passed. */
  integrationTestsPassed?: boolean;
  /** Number of integration test failures. */
  integrationFailures?: number;
  /** Audit verdict for the current scope. */
  auditVerdict?: "approved" | "changes_requested" | "infra_failure";
  /** Active amendment count that may conflict. */
  pendingAmendments?: number;
  /** Detected law contradictions (from manual or automated check). */
  lawContradictions?: string[];
}

// ── Core Verification ────────────────────────

/**
 * Run all 4 confluence checks.
 */
export function verifyConfluence(input: ConfluenceInput): ConfluenceResult {
  const checks: ConfluenceCheck[] = [];
  const suggestedAmendments: SuggestedAmendment[] = [];

  // 1. Law ↔ Code (relies on audit result)
  checks.push(checkLawCode(input));

  // 2. Part ↔ Whole (integration test results)
  const partWhole = checkPartWhole(input);
  checks.push(partWhole);
  if (!partWhole.passed) {
    suggestedAmendments.push({
      target: "wb",
      change: "Add integration test coverage for failing module boundaries",
      justification: partWhole.detail,
      source: "part-whole",
    });
  }

  // 3. Intent ↔ Result (CPS problem solved?)
  const intentResult = checkIntentResult(input);
  checks.push(intentResult);
  if (!intentResult.passed) {
    suggestedAmendments.push({
      target: "prd",
      change: "Review FR acceptance criteria — implementation may not solve original problem",
      justification: intentResult.detail,
      source: "intent-result",
    });
  }

  // 4. Law ↔ Law (contradictions between different laws)
  const lawLaw = checkLawLaw(input);
  checks.push(lawLaw);
  if (!lawLaw.passed) {
    suggestedAmendments.push({
      target: "design",
      change: "Resolve contradictions between design decisions",
      justification: lawLaw.detail,
      source: "law-law",
    });
  }

  const passed = checks.every(c => c.passed || c.severity === "info");

  return {
    passed,
    checks,
    suggestedAmendments,
    timestamp: Date.now(),
  };
}

// ── Individual Checks ────────────────────────

function checkLawCode(input: ConfluenceInput): ConfluenceCheck {
  if (input.auditVerdict === "approved") {
    return { type: "law-code", passed: true, detail: "Audit approved — law and code aligned", severity: "info" };
  }
  if (input.auditVerdict === "changes_requested") {
    return { type: "law-code", passed: false, detail: "Audit requested changes — law-code mismatch exists", severity: "error" };
  }
  return { type: "law-code", passed: true, detail: "No audit verdict available — skipping", severity: "info" };
}

function checkPartWhole(input: ConfluenceInput): ConfluenceCheck {
  if (input.integrationTestsPassed === true) {
    return { type: "part-whole", passed: true, detail: "Integration tests passed — modules work together", severity: "info" };
  }
  if (input.integrationTestsPassed === false) {
    const failures = input.integrationFailures ?? 0;
    return {
      type: "part-whole",
      passed: false,
      detail: `Integration tests failed (${failures} failures) — modules may not integrate correctly`,
      severity: "error",
    };
  }
  return { type: "part-whole", passed: true, detail: "No integration test data — skipping", severity: "warning" };
}

function checkIntentResult(input: ConfluenceInput): ConfluenceCheck {
  if (!input.cps) {
    return { type: "intent-result", passed: true, detail: "No CPS available — cannot verify intent alignment", severity: "warning" };
  }

  // If there are gaps remaining and audit passed, the intent may not be fully addressed
  if (input.cps.gaps.length > 0 && input.auditVerdict === "approved") {
    return {
      type: "intent-result",
      passed: false,
      detail: `CPS has ${input.cps.gaps.length} unresolved gaps: ${input.cps.gaps.map(g => g.item).join(", ")}`,
      severity: "warning",
    };
  }

  if (input.cps.builds.length === 0) {
    return { type: "intent-result", passed: true, detail: "No build items in CPS — nothing to verify", severity: "info" };
  }

  return { type: "intent-result", passed: true, detail: "CPS problem appears addressed by implementation", severity: "info" };
}

function checkLawLaw(input: ConfluenceInput): ConfluenceCheck {
  if (input.lawContradictions && input.lawContradictions.length > 0) {
    return {
      type: "law-law",
      passed: false,
      detail: `Law contradictions detected: ${input.lawContradictions.join("; ")}`,
      severity: "error",
    };
  }

  if (input.pendingAmendments && input.pendingAmendments > 3) {
    return {
      type: "law-law",
      passed: true,
      detail: `${input.pendingAmendments} pending amendments — review for potential contradictions`,
      severity: "warning",
    };
  }

  return { type: "law-law", passed: true, detail: "No law contradictions detected", severity: "info" };
}
