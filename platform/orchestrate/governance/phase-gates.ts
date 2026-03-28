/**
 * Phase completion gates — "can we proceed to the next phase?"
 *
 * Pure verification logic: checks items, verify commands, regressions.
 * No execution logic, no agent spawning.
 */

import { execSync } from "node:child_process";
import type { WorkItem } from "../../cli/commands/orchestrate/shared.js";
import type { PromotionGate, PromotionGateResult } from "../../bus/promotion-gate.js";

/**
 * Verify Phase N is complete before allowing Phase N+1.
 * Checks: all items completed, verify commands pass, no regressions,
 * and (optionally) evaluation contract promotion gate.
 *
 * @param repoRoot - Repository root path
 * @param phaseId - Current phase identifier
 * @param phaseItems - All work items in the phase
 * @param completedIds - Set of completed item IDs
 * @param detectRegressionsFn - Regression detection function (injected to avoid circular deps)
 * @param contractOpts - Optional contract control plane parameters
 */
export function verifyPhaseCompletion(
  repoRoot: string,
  phaseId: string,
  phaseItems: WorkItem[],
  completedIds: Set<string>,
  detectRegressionsFn?: (repoRoot: string, files: string[], ref?: string) => string[],
  contractOpts?: {
    // [CONTRACT CONTROL PLANE] Optional evaluation contract check at phase completion.
    // When evaluationContractId and promotionGate are provided, verify promotion is
    // allowed before progressing to the next phase. See PLT-6D/6E for contract model details.
    evaluationContractId?: string;
    promotionGate?: PromotionGate;
    /** Score map passed to PromotionGate.canPromote() for evaluation threshold check. */
    scores?: Record<string, number>;
  },
): { passed: boolean; failures: string[] } {

  const failures: string[] = [];

  // 1. All items in phase must be completed
  const incomplete = phaseItems.filter(i => !completedIds.has(i.id));
  if (incomplete.length > 0) {
    failures.push(`${incomplete.length} item(s) incomplete: ${incomplete.map(i => i.id).join(", ")}`);
  }

  // 2. Re-run verify commands (integration check)
  for (const item of phaseItems) {
    if (!item.verify || !completedIds.has(item.id)) continue;
    try {
      execSync(item.verify, { cwd: repoRoot, timeout: 60_000, stdio: "pipe", windowsHide: true });
    } catch {
      failures.push(`${item.id} verify failed: ${item.verify}`);
    }
  }

  // 3. Regression check on all phase files
  if (detectRegressionsFn) {
    const phaseFiles = [...new Set(phaseItems.flatMap(i => i.targetFiles))];
    const regressions = detectRegressionsFn(repoRoot, phaseFiles);
    for (const r of regressions) failures.push(`Regression: ${r}`);
  }

  // 4. [CONTRACT CONTROL PLANE] Evaluation contract promotion gate
  if (contractOpts?.evaluationContractId && contractOpts.promotionGate) {
    const gateResult: PromotionGateResult = contractOpts.promotionGate.canPromote(
      contractOpts.evaluationContractId,
      contractOpts.scores ?? {},
    );
    if (!gateResult.allowed) {
      failures.push(`Contract promotion blocked: ${gateResult.reason}`);
    }
  }

  return { passed: failures.length === 0, failures };
}

/**
 * Check if all items in a wave are already completed (for resume skip).
 */
export function isWaveFullyCompleted(
  waveItems: WorkItem[],
  completedIds: Set<string>,
): boolean {
  return waveItems.every(i => completedIds.has(i.id));
}

/**
 * Get items in a wave that need retrying (failed in previous run).
 */
export function getRetryItems(
  waveItems: WorkItem[],
  completedIds: Set<string>,
): WorkItem[] {
  return waveItems.filter(i => !completedIds.has(i.id));
}
