/**
 * Contract negotiation gate — bilateral contract approval enforcement.
 *
 * Sprint contracts cannot be approved without evaluator participation.
 * This ensures the evaluation harness has reviewed and agreed to the
 * contract terms before implementation begins.
 */

import type { SprintContract } from '../../core/harness/sprint-contract.js';
import type { ContractNegotiationRecord } from '../../core/harness/negotiation-record.js';
import { hasEvaluatorParticipation } from '../../core/harness/negotiation-record.js';

export interface NegotiationContext {
  sprintContract: SprintContract;
  records: ContractNegotiationRecord[];
}

/**
 * Validate that a sprint contract has sufficient negotiation history
 * before it can be approved. Returns { valid, reason }.
 */
export function validateNegotiation(ctx: NegotiationContext): { valid: boolean; reason?: string } {
  if (ctx.sprintContract.approvalState !== 'approved') {
    return { valid: true }; // Only check approved contracts
  }
  if (!hasEvaluatorParticipation(ctx.records)) {
    return { valid: false, reason: 'Sprint contract approved without evaluator-side negotiation record' };
  }
  if (ctx.records.length === 0) {
    return { valid: false, reason: 'No negotiation records found for contract' };
  }
  return { valid: true };
}

/**
 * Attempt to approve a sprint contract. Throws if evaluator participation is missing.
 */
export function approveWithNegotiation(
  contract: SprintContract,
  records: ContractNegotiationRecord[]
): SprintContract {
  if (!hasEvaluatorParticipation(records)) {
    throw new Error(`Cannot approve contract ${contract.contractId}: evaluator-side negotiation required`);
  }
  return { ...contract, approvalState: 'approved' };
}
