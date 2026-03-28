/**
 * Confluence gates — cross-cutting integrity verification wrapper.
 *
 * Thin governance layer over bus/confluence.ts.
 * Provides orchestrator-friendly interface for post-audit whole-system checks.
 */

import { verifyConfluence, type ConfluenceInput, type ConfluenceResult } from "../../bus/confluence.js";
import { AUDIT_VERDICT } from "../../bus/events.js";
import { proposeAmendment } from "../../bus/amendment.js";

// Re-export for convenience
export type { ConfluenceInput, ConfluenceResult };
export { AUDIT_VERDICT };

/**
 * Run confluence verification after a successful wave audit.
 * Checks 4 integrity points: law-code, part-whole, intent-result, law-law.
 *
 * @param auditPassed - Whether the wave audit passed
 * @param testResult - Project test result (ran + passed)
 * @returns Confluence verification result
 */
export function runConfluenceCheck(
  auditPassed: boolean,
  testResult: { ran: boolean; passed: boolean },
): ConfluenceResult {
  return verifyConfluence({
    auditVerdict: auditPassed ? AUDIT_VERDICT.APPROVED : AUDIT_VERDICT.CHANGES_REQUESTED,
    integrationTestsPassed: testResult.ran ? testResult.passed : undefined,
    integrationFailures: testResult.ran && !testResult.passed ? 1 : 0,
  } as ConfluenceInput);
}

/**
 * Propose amendments for confluence mismatches.
 * Called when confluence check finds issues that need legislative correction.
 *
 * @param store - EventStore instance
 * @param suggestedAmendments - Amendments suggested by confluence check
 * @returns Number of amendments proposed
 */
export function proposeConfluenceAmendments(
  store: any,
  suggestedAmendments: Array<{ target: string; change: string; justification: string }>,
): number {
  let proposed = 0;
  for (const sa of suggestedAmendments) {
    try {
      proposeAmendment(store, {
        target: sa.target as "prd" | "design" | "wb" | "scope",
        change: sa.change,
        sponsor: "orchestrator",
        sponsorRole: "judge",
        justification: sa.justification,
      });
      proposed++;
    } catch { /* fail-open */ }
  }
  return proposed;
}
