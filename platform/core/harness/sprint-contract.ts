import { randomUUID } from 'node:crypto';

export interface SprintContract {
  contractId: string;
  trackName: string;
  waveId: string;
  scope: string[];
  doneCriteria: string[];
  evidenceRequired: string[];
  approvalState: 'draft' | 'approved' | 'rejected';
}

export function createSprintContract(
  partial: Partial<SprintContract> & Pick<SprintContract, 'trackName' | 'waveId'>,
): SprintContract {
  return {
    contractId: partial.contractId ?? randomUUID(),
    trackName: partial.trackName,
    waveId: partial.waveId,
    scope: partial.scope ?? [],
    doneCriteria: partial.doneCriteria ?? [],
    evidenceRequired: partial.evidenceRequired ?? [],
    approvalState: partial.approvalState ?? 'draft',
  };
}

export function isApproved(contract: SprintContract): boolean {
  return contract.approvalState === 'approved';
}
