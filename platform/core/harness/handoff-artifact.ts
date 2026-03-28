import { randomUUID } from 'node:crypto';

export interface HandoffArtifact {
  contractId: string;
  summary: string;
  openItems: string[];
  residualRisks: string[];
  rtmRefs: string[];
  nextAction: string;
}

export interface SessionEnvelope {
  sessionId: string;
  mode: 'reset' | 'compact' | 'resume';
  contractId: string;
  handoffRef?: string;
}

export function createHandoffArtifact(
  partial: Partial<HandoffArtifact> & Pick<HandoffArtifact, 'contractId'>,
): HandoffArtifact {
  return {
    contractId: partial.contractId,
    summary: partial.summary ?? '',
    openItems: partial.openItems ?? [],
    residualRisks: partial.residualRisks ?? [],
    rtmRefs: partial.rtmRefs ?? [],
    nextAction: partial.nextAction ?? '',
  };
}

export function isComplete(artifact: HandoffArtifact): boolean {
  if (!artifact.summary) return false;
  if (!artifact.nextAction) return false;
  if (artifact.openItems.some((item) => !item)) return false;
  return true;
}
