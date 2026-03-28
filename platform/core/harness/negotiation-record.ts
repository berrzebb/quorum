import { randomUUID } from 'node:crypto';

export interface ContractNegotiationRecord {
  recordId: string;
  sprintContractId: string;
  proposedBy: 'planner' | 'generator' | 'evaluator';
  status: 'draft' | 'countered' | 'approved' | 'rejected';
  requestedChanges: string[];
  participants: string[];
}

export function createNegotiationRecord(
  partial: Partial<ContractNegotiationRecord> & Pick<ContractNegotiationRecord, 'sprintContractId' | 'proposedBy'>,
): ContractNegotiationRecord {
  return {
    recordId: partial.recordId ?? randomUUID(),
    sprintContractId: partial.sprintContractId,
    proposedBy: partial.proposedBy,
    status: partial.status ?? 'draft',
    requestedChanges: partial.requestedChanges ?? [],
    participants: partial.participants ?? [],
  };
}

export function hasEvaluatorParticipation(records: ContractNegotiationRecord[]): boolean {
  return records.some(
    (r) => r.proposedBy === 'evaluator' || r.participants.includes('evaluator'),
  );
}
