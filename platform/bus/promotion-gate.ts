/**
 * Promotion Gate — reads from ContractLedger to gate wave starts and promotions.
 *
 * Higher-level gate that wraps StrictContractEnforcer with ledger lookups.
 * Returns { allowed, reason? } instead of throwing — suitable for gate checks.
 */

import type { ContractLedger } from '../core/harness/contract-ledger.js';
import { StrictContractEnforcer } from './contract-enforcer.js';

// ── Gate result ─────────────────────────────

export interface PromotionGateResult {
  allowed: boolean;
  reason?: string;
}

// ── Promotion Gate ──────────────────────────

export class PromotionGate {
  private enforcer = new StrictContractEnforcer();

  constructor(private ledger: ContractLedger) {}

  canStartWave(contractId: string): PromotionGateResult {
    const sprint = this.ledger.getSprintContract(contractId);
    if (!sprint) return { allowed: false, reason: 'Sprint contract not found' };
    try {
      this.enforcer.assertSprintApproved(sprint);
      return { allowed: true };
    } catch (e) {
      return { allowed: false, reason: (e as Error).message };
    }
  }

  canPromote(
    contractId: string,
    scores: Record<string, number>,
  ): PromotionGateResult {
    const sprint = this.ledger.getSprintContract(contractId);
    const evaluation = this.ledger.getEvaluationContract(contractId);
    if (!sprint) return { allowed: false, reason: 'Sprint contract not found' };
    if (!evaluation)
      return { allowed: false, reason: 'Evaluation contract not found' };
    try {
      this.enforcer.assertSprintApproved(sprint);
      this.enforcer.assertEvaluationReady(evaluation, scores);
      return { allowed: true };
    } catch (e) {
      return { allowed: false, reason: (e as Error).message };
    }
  }
}
