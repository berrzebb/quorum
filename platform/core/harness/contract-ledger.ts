import type { SprintContract } from './sprint-contract.js';
import type { EvaluationContract } from './evaluation-contract.js';
import type { HandoffArtifact } from './handoff-artifact.js';

export interface ContractLedger {
  getSprintContract(contractId: string): SprintContract | undefined;
  getEvaluationContract(contractId: string): EvaluationContract | undefined;
  getHandoffArtifact(contractId: string): HandoffArtifact | undefined;
  storeSprintContract(contract: SprintContract): void;
  storeEvaluationContract(contract: EvaluationContract): void;
  storeHandoffArtifact(artifact: HandoffArtifact): void;
  listSprintContracts(trackName?: string): SprintContract[];
}

export class InMemoryContractLedger implements ContractLedger {
  private sprints = new Map<string, SprintContract>();
  private evaluations = new Map<string, EvaluationContract>();
  private handoffs = new Map<string, HandoffArtifact>();

  getSprintContract(contractId: string): SprintContract | undefined {
    return this.sprints.get(contractId);
  }

  getEvaluationContract(contractId: string): EvaluationContract | undefined {
    return this.evaluations.get(contractId);
  }

  getHandoffArtifact(contractId: string): HandoffArtifact | undefined {
    return this.handoffs.get(contractId);
  }

  storeSprintContract(contract: SprintContract): void {
    this.sprints.set(contract.contractId, contract);
  }

  storeEvaluationContract(contract: EvaluationContract): void {
    this.evaluations.set(contract.contractId, contract);
  }

  storeHandoffArtifact(artifact: HandoffArtifact): void {
    this.handoffs.set(artifact.contractId, artifact);
  }

  listSprintContracts(trackName?: string): SprintContract[] {
    const all = Array.from(this.sprints.values());
    if (trackName === undefined) return all;
    return all.filter((c) => c.trackName === trackName);
  }
}
