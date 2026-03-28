/**
 * Handoff Gate — reads from ContractLedger to gate session resume.
 *
 * Blocks resume when handoff artifact is missing or incomplete.
 * Returns { allowed, reason? } instead of throwing — suitable for gate checks.
 */

import type { ContractLedger } from '../core/harness/contract-ledger.js';
import { StrictContractEnforcer } from './contract-enforcer.js';

// ── Gate result ─────────────────────────────

export interface HandoffGateResult {
  allowed: boolean;
  reason?: string;
}

// ── Handoff Gate ────────────────────────────

export class HandoffGate {
  private enforcer = new StrictContractEnforcer();

  constructor(private ledger: ContractLedger) {}

  canResume(contractId: string): HandoffGateResult {
    const handoff = this.ledger.getHandoffArtifact(contractId);
    if (!handoff)
      return { allowed: false, reason: 'Handoff artifact not found' };
    try {
      this.enforcer.assertHandoffComplete(handoff);
      return { allowed: true };
    } catch (e) {
      return { allowed: false, reason: (e as Error).message };
    }
  }
}
