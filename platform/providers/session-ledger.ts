import type { ProviderSessionRecord, ProviderApprovalRecord } from '../core/harness/provider-session-record.js';

/**
 * Port for storing and querying provider session records.
 * In-memory implementation provided; can be swapped with SQLite later.
 */
export interface SessionLedger {
  /** Store or update a provider session record */
  upsert(record: ProviderSessionRecord): void;
  /** Find record by quorum session id */
  findByQuorumSession(quorumSessionId: string): ProviderSessionRecord | undefined;
  /** Find record by provider session id */
  findByProviderSession(providerSessionId: string): ProviderSessionRecord | undefined;
  /** Find all records for a contract */
  findByContract(contractId: string): ProviderSessionRecord[];
  /** Update session state */
  updateState(quorumSessionId: string, state: ProviderSessionRecord['state']): void;
  /** Record an approval request */
  recordApproval(record: ProviderApprovalRecord): void;
  /** Find pending (undecided) approvals for a session */
  pendingApprovals(providerSessionId: string): ProviderApprovalRecord[];
  /** Record an approval decision */
  resolveApproval(requestId: string, decision: 'allow' | 'deny'): void;
}

/**
 * In-memory implementation of SessionLedger.
 */
export class InMemorySessionLedger implements SessionLedger {
  private sessions = new Map<string, ProviderSessionRecord>();
  private approvals = new Map<string, ProviderApprovalRecord>();

  upsert(record: ProviderSessionRecord): void {
    record.updatedAt = Date.now();
    this.sessions.set(record.quorumSessionId, record);
  }

  findByQuorumSession(quorumSessionId: string): ProviderSessionRecord | undefined {
    return this.sessions.get(quorumSessionId);
  }

  findByProviderSession(providerSessionId: string): ProviderSessionRecord | undefined {
    for (const record of this.sessions.values()) {
      if (record.providerRef.providerSessionId === providerSessionId) return record;
    }
    return undefined;
  }

  findByContract(contractId: string): ProviderSessionRecord[] {
    const results: ProviderSessionRecord[] = [];
    for (const record of this.sessions.values()) {
      if (record.contractId === contractId) results.push(record);
    }
    return results;
  }

  updateState(quorumSessionId: string, state: ProviderSessionRecord['state']): void {
    const record = this.sessions.get(quorumSessionId);
    if (record) {
      record.state = state;
      record.updatedAt = Date.now();
    }
  }

  recordApproval(record: ProviderApprovalRecord): void {
    this.approvals.set(record.requestId, record);
  }

  pendingApprovals(providerSessionId: string): ProviderApprovalRecord[] {
    const results: ProviderApprovalRecord[] = [];
    for (const approval of this.approvals.values()) {
      if (
        approval.providerRef.providerSessionId === providerSessionId &&
        approval.decision === undefined
      ) {
        results.push(approval);
      }
    }
    return results;
  }

  resolveApproval(requestId: string, decision: 'allow' | 'deny'): void {
    const approval = this.approvals.get(requestId);
    if (approval) {
      approval.decision = decision;
      approval.decidedAt = Date.now();
    }
  }
}
