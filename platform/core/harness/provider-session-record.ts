import type { ProviderSessionRef } from '../../providers/session-runtime.js';

/**
 * Tracks the binding between a quorum session and a provider-native session.
 */
export interface ProviderSessionRecord {
  /** Quorum-side session id */
  quorumSessionId: string;
  /** Sprint contract id (if bound to a contract) */
  contractId?: string;
  /** Provider-native session reference */
  providerRef: ProviderSessionRef;
  /** When this record was created */
  startedAt: number;
  /** When this record was last updated */
  updatedAt: number;
  /** Current provider session state */
  state: 'running' | 'waiting_approval' | 'completed' | 'failed' | 'detached';
}

/**
 * Tracks an approval request/decision pair for a provider session.
 */
export interface ProviderApprovalRecord {
  /** Provider-native session reference */
  providerRef: ProviderSessionRef;
  /** Unique request id */
  requestId: string;
  /** Approval kind */
  kind: 'tool' | 'command' | 'diff' | 'network';
  /** Reason from provider */
  reason: string;
  /** Quorum gate decision */
  decision?: 'allow' | 'deny';
  /** When the request was received */
  requestedAt: number;
  /** When the decision was made */
  decidedAt?: number;
}

/**
 * Create a new ProviderSessionRecord with defaults.
 */
export function createProviderSessionRecord(
  partial: Pick<ProviderSessionRecord, 'quorumSessionId' | 'providerRef'> &
    Partial<ProviderSessionRecord>,
): ProviderSessionRecord {
  return {
    contractId: undefined,
    startedAt: Date.now(),
    updatedAt: Date.now(),
    state: 'running',
    ...partial,
  };
}

/**
 * Create a new ProviderApprovalRecord.
 */
export function createProviderApprovalRecord(
  partial: Pick<ProviderApprovalRecord, 'providerRef' | 'requestId' | 'kind' | 'reason'> &
    Partial<ProviderApprovalRecord>,
): ProviderApprovalRecord {
  return {
    requestedAt: Date.now(),
    ...partial,
  };
}
