/**
 * Contract Enforcement Gates — structural enforcement, not guidelines.
 *
 * These gates BLOCK operations when contract conditions are not satisfied.
 * Each assert method throws ContractViolationError on failure.
 *
 * Gates:
 * 1. Sprint gate: blocks when sprint contract is not approved
 * 2. Evaluation gate: blocks when evaluation thresholds are not met
 * 3. Handoff gate: blocks when handoff artifact is incomplete
 * 4. Promotion gate: composite check (sprint + evaluation + optional handoff)
 */

import type { SprintContract } from '../core/harness/sprint-contract.js';
import type { EvaluationContract } from '../core/harness/evaluation-contract.js';
import type { HandoffArtifact } from '../core/harness/handoff-artifact.js';
import { isApproved } from '../core/harness/sprint-contract.js';
import { meetsThresholds } from '../core/harness/evaluation-contract.js';
import { isComplete } from '../core/harness/handoff-artifact.js';

// ── Error type ──────────────────────────────

export class ContractViolationError extends Error {
  constructor(
    public readonly gate: string,
    message: string,
  ) {
    super(message);
    this.name = 'ContractViolationError';
  }
}

// ── Interface ───────────────────────────────

export interface ContractEnforcer {
  assertSprintApproved(contract: SprintContract): void;
  assertEvaluationReady(
    contract: EvaluationContract,
    scores: Record<string, number>,
  ): void;
  assertHandoffComplete(handoff: HandoffArtifact): void;
  assertPromotionAllowed(input: {
    sprint: SprintContract;
    evaluation: EvaluationContract;
    scores: Record<string, number>;
    handoff?: HandoffArtifact;
  }): void;
}

// ── Strict implementation ───────────────────

export class StrictContractEnforcer implements ContractEnforcer {
  assertSprintApproved(contract: SprintContract): void {
    if (!isApproved(contract)) {
      throw new ContractViolationError(
        'sprint',
        `Sprint contract ${contract.contractId} is not approved (state: ${contract.approvalState})`,
      );
    }
  }

  assertEvaluationReady(
    contract: EvaluationContract,
    scores: Record<string, number>,
  ): void {
    if (!meetsThresholds(contract, scores)) {
      throw new ContractViolationError(
        'evaluation',
        `Evaluation contract ${contract.contractId} thresholds not met`,
      );
    }
  }

  assertHandoffComplete(handoff: HandoffArtifact): void {
    if (!isComplete(handoff)) {
      throw new ContractViolationError(
        'handoff',
        `Handoff artifact for contract ${handoff.contractId} is incomplete`,
      );
    }
  }

  assertPromotionAllowed(input: {
    sprint: SprintContract;
    evaluation: EvaluationContract;
    scores: Record<string, number>;
    handoff?: HandoffArtifact;
  }): void {
    this.assertSprintApproved(input.sprint);
    this.assertEvaluationReady(input.evaluation, input.scores);
    if (input.handoff) {
      this.assertHandoffComplete(input.handoff);
    }
  }
}
