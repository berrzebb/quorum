/**
 * Provider Approval Gate — mediates between provider-native approval requests
 * and quorum's contract enforcement system.
 *
 * Receives approval requests from provider runtimes, evaluates them through
 * a policy chain, and returns allow/deny decisions. Prevents provider runtime
 * from approving actions independently.
 *
 * Fail-closed: if no policy explicitly allows, the default is deny.
 */

import type {
  ProviderApprovalRequest,
  ProviderApprovalDecision,
} from "../providers/session-runtime.js";
import type { SessionLedger } from "../providers/session-ledger.js";
import type { ContractLedger } from "../core/harness/contract-ledger.js";

// ── Policy interface ────────────────────────────

/**
 * Policy that determines approval based on quorum contracts.
 */
export interface ApprovalPolicy {
  /** Policy name for logging */
  readonly name: string;
  /**
   * Evaluate an approval request against quorum contracts.
   * Returns "allow", "deny", or "defer" (pass to next policy).
   */
  evaluate(
    request: ProviderApprovalRequest,
    context: ApprovalContext
  ): "allow" | "deny" | "defer";
}

// ── Context ─────────────────────────────────────

/**
 * Context available to approval policies.
 */
export interface ApprovalContext {
  contractId?: string;
  quorumSessionId?: string;
  /** Allowed tool names from contract scope */
  allowedTools?: string[];
}

// ── Gate result ─────────────────────────────────

/**
 * Result of approval gate evaluation.
 */
export interface ApprovalGateResult {
  decision: "allow" | "deny";
  /** Which policy made the decision */
  decidedBy: string;
  /** Reason for the decision */
  reason: string;
}

// ── ProviderApprovalGate ────────────────────────

/**
 * Gate that mediates between provider-native approval requests
 * and quorum's contract enforcement system.
 *
 * Fail-closed: if no policy explicitly allows, the default is deny.
 */
export class ProviderApprovalGate {
  private policies: ApprovalPolicy[] = [];

  constructor(
    private readonly sessionLedger: SessionLedger,
    private readonly contractLedger?: ContractLedger
  ) {}

  /**
   * Register an approval policy. Policies are evaluated in order.
   */
  addPolicy(policy: ApprovalPolicy): void {
    this.policies.push(policy);
  }

  /**
   * Evaluate an approval request through the policy chain.
   * First non-"defer" result wins. Default is deny (fail-closed).
   */
  evaluate(request: ProviderApprovalRequest): ApprovalGateResult {
    // Build context from session ledger
    const sessionRecord = this.sessionLedger.findByProviderSession(
      request.providerRef.providerSessionId
    );

    const context: ApprovalContext = {
      contractId: sessionRecord?.contractId,
      quorumSessionId: sessionRecord?.quorumSessionId,
    };

    // If we have a contract, load scope
    if (context.contractId && this.contractLedger) {
      const sprint = this.contractLedger.getSprintContract(context.contractId);
      if (sprint) {
        context.allowedTools = sprint.scope;
      }
    }

    // Evaluate policies in order
    for (const policy of this.policies) {
      const result = policy.evaluate(request, context);
      if (result !== "defer") {
        return {
          decision: result,
          decidedBy: policy.name,
          reason: `${policy.name}: ${result} for ${request.kind} "${request.reason}"`,
        };
      }
    }

    // Fail-closed default
    return {
      decision: "deny",
      decidedBy: "default",
      reason: `No policy allowed ${request.kind} request: "${request.reason}"`,
    };
  }

  /**
   * Process a full approval lifecycle:
   * 1. Record the request in session ledger
   * 2. Evaluate through policy chain
   * 3. Resolve the approval in session ledger
   * 4. Update session state if needed
   */
  process(request: ProviderApprovalRequest): ProviderApprovalDecision {
    // 1. Record request
    this.sessionLedger.recordApproval({
      providerRef: request.providerRef,
      requestId: request.requestId,
      kind: request.kind,
      reason: request.reason,
      requestedAt: Date.now(),
    });

    // 2. Update session state to waiting_approval
    const sessionRecord = this.sessionLedger.findByProviderSession(
      request.providerRef.providerSessionId
    );
    if (sessionRecord) {
      this.sessionLedger.updateState(sessionRecord.quorumSessionId, "waiting_approval");
    }

    // 3. Evaluate
    const result = this.evaluate(request);

    // 4. Resolve in ledger
    this.sessionLedger.resolveApproval(request.requestId, result.decision);

    // 5. Restore session state
    if (sessionRecord) {
      this.sessionLedger.updateState(
        sessionRecord.quorumSessionId,
        result.decision === "allow" ? "running" : "failed"
      );
    }

    return {
      requestId: request.requestId,
      decision: result.decision,
    };
  }
}

// ── Built-in policies ───────────────────────────

/**
 * Built-in policy: allow tools that are in the contract scope.
 */
export class ScopeBasedPolicy implements ApprovalPolicy {
  readonly name = "scope-based";

  evaluate(
    request: ProviderApprovalRequest,
    context: ApprovalContext
  ): "allow" | "deny" | "defer" {
    if (request.kind !== "tool") return "defer";
    if (!context.allowedTools) return "defer";

    // Check if any scope entry matches the tool request
    const toolName = request.reason;
    if (context.allowedTools.includes(toolName)) return "allow";

    return "defer";
  }
}

/**
 * Built-in policy: deny all network requests (conservative default).
 */
export class DenyNetworkPolicy implements ApprovalPolicy {
  readonly name = "deny-network";

  evaluate(
    request: ProviderApprovalRequest,
    _context: ApprovalContext
  ): "allow" | "deny" | "defer" {
    if (request.kind === "network") return "deny";
    return "defer";
  }
}

/**
 * Built-in policy: allow all (for development/testing only).
 */
export class AllowAllPolicy implements ApprovalPolicy {
  readonly name = "allow-all";

  evaluate(): "allow" | "deny" | "defer" {
    return "allow";
  }
}
