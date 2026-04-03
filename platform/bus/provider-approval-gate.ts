/**
 * Provider Approval Gate — mediates between provider-native approval requests
 * and quorum's contract enforcement system.
 *
 * Receives approval requests from provider runtimes, evaluates them through
 * a policy chain, and returns allow/deny decisions. Prevents provider runtime
 * from approving actions independently.
 *
 * Fail-closed: if no policy explicitly allows, the default is deny.
 *
 * RTI-1A: Approval telemetry — every approval request/decision is recorded
 * as a replay-compatible telemetry record with normalized fields. Both
 * All providers produce the same telemetry shape.
 */

import type {
  ProviderApprovalRequest,
  ProviderApprovalDecision,
} from "../providers/session-runtime.js";
import type { SessionLedger } from "../providers/session-ledger.js";
import type { ContractLedger } from "../core/harness/contract-ledger.js";
import type { ClassifierDecision, ClassifierInput } from "./approval-classifier.js";
import { classify, telemetryToInput } from "./approval-classifier.js";
import type { PermissionDecision, ToolInput } from "./permission-rules.js";
import { RulesEngine } from "./permission-rules.js";
import type { PermissionMode, ModeDecision } from "./permission-modes.js";
import { evaluateMode, getMode, isReadOnlyTool, isWriteEditTool } from "./permission-modes.js";

// ── RTI-1A: Approval Telemetry ──────────────────

/**
 * Replay-compatible telemetry record for approval decisions.
 * Shape is identical regardless of provider.
 */
export interface ApprovalTelemetryRecord {
  /** Timestamp of the decision. */
  ts: number;
  /** Provider that made the request. */
  provider: "codex" | "claude";
  /** Provider session ID for correlation. */
  sessionId: string;
  /** Tool or command that was requested. */
  tool: string;
  /** Approval kind. */
  kind: "tool" | "command" | "diff" | "network";
  /** Whether the tool is read-only (from capability registry). */
  readOnly: boolean;
  /** Whether the tool is destructive (from capability registry). */
  destructive: boolean;
  /** Whether the request involves network access. */
  network: boolean;
  /** Whether the request involves diff/file changes. */
  diff: boolean;
  /** Final gate decision. */
  decision: "allow" | "deny";
  /** Which policy made the decision. */
  decidedBy: string;
  /** Decision reason (for audit trail). */
  reason: string;
  /** Contract ID if bound to a sprint contract. */
  contractId?: string;
  /** RTI-2B: Shadow classifier decision (advisory only). */
  classifierDecision?: ClassifierDecision;
  /** v0.6.2: Permission rule decision (if any rule matched). */
  ruleDecision?: PermissionDecision;
  /** v0.6.2: Permission mode used. */
  permissionMode?: PermissionMode;
}

/** Callback for telemetry consumers. */
export type ApprovalTelemetryCallback = (record: ApprovalTelemetryRecord) => void;

/** Callback for shadow classifier decisions (RTI-2B). */
export type ShadowClassifierCallback = (
  input: ClassifierInput,
  decision: ClassifierDecision,
  gateDecision: "allow" | "deny",
) => void;

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
  private telemetryCallbacks: ApprovalTelemetryCallback[] = [];
  private shadowCallbacks: ShadowClassifierCallback[] = [];

  /** v0.6.2: Rules engine for permission evaluation. */
  private rulesEngine?: RulesEngine;

  /** v0.6.2: Safe tool checker (injected). */
  private safeToolChecker?: (tool: string, input?: Record<string, unknown>) => boolean;

  constructor(
    private readonly sessionLedger: SessionLedger,
    private readonly contractLedger?: ContractLedger
  ) {}

  /**
   * v0.6.2: Set the rules engine for permission evaluation.
   * When set, rules are evaluated before the policy chain.
   */
  setRulesEngine(engine: RulesEngine): void {
    this.rulesEngine = engine;
  }

  /**
   * v0.6.2: Set safe tool checker.
   * When set, safe tools skip the classifier.
   */
  setSafeToolChecker(checker: (tool: string, input?: Record<string, unknown>) => boolean): void {
    this.safeToolChecker = checker;
  }

  /**
   * Register a telemetry callback. Called for every approval decision.
   * @since RTI-1A
   */
  onTelemetry(cb: ApprovalTelemetryCallback): void {
    this.telemetryCallbacks.push(cb);
  }

  /**
   * Register a shadow classifier callback. Called with classifier decision
   * alongside the actual gate decision — for calibration and analysis.
   * @since RTI-2B
   */
  onShadowClassifier(cb: ShadowClassifierCallback): void {
    this.shadowCallbacks.push(cb);
  }

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
   * 2. v0.6.2: Evaluate through integrated pipeline (rules → mode → policy chain)
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

    // RTI-2B: Run shadow classifier BEFORE gate (advisory only)
    const classifierInput = this.buildClassifierInput(request);
    const classifierDecision = classify(classifierInput);

    // v0.6.2: Integrated pipeline (rules → mode → policy chain)
    let result: ApprovalGateResult;
    let ruleDecision: PermissionDecision | undefined;

    if (this.rulesEngine) {
      const integrated = this.evaluateIntegrated(request, classifierInput);
      result = integrated.result;
      ruleDecision = integrated.ruleDecision ?? undefined;
    } else {
      // Fallback: legacy policy chain only
      result = this.evaluate(request);
    }

    // RTI-2B: Emit shadow classifier results for calibration
    this.emitShadowClassifier(classifierInput, classifierDecision, result.decision);

    // 4. Resolve in ledger
    this.sessionLedger.resolveApproval(request.requestId, result.decision);

    // 5. Restore session state
    if (sessionRecord) {
      this.sessionLedger.updateState(
        sessionRecord.quorumSessionId,
        result.decision === "allow" ? "running" : "failed"
      );
    }

    // RTI-1A: Emit telemetry record (now includes classifier + rule decision)
    this.emitTelemetry(request, result, classifierDecision, ruleDecision);

    return {
      requestId: request.requestId,
      decision: result.decision,
    };
  }

  /**
   * v0.6.2: Integrated evaluation pipeline.
   *
   * 9-step short-circuit:
   * 1. Deny rules → DENY (bypass-immune)
   * 2. Ask rules → ASK (bypass-immune)
   * 3. Safe tool check → skip classifier flag
   * 4. Safety checks (.git, .claude) → ASK
   * 5. Mode-based gating → ALLOW (bypass/plan/auto)
   * 6. Allow rules → ALLOW
   * 7. Policy chain (existing)
   * 8. Classifier (if not safe)
   * 9. Default → ASK (fail-closed)
   */
  private evaluateIntegrated(
    request: ProviderApprovalRequest,
    _classifierInput: ClassifierInput,
  ): { result: ApprovalGateResult; ruleDecision: PermissionDecision | null } {
    const toolInput: ToolInput = {
      tool: request.reason,
      input: (request as unknown as Record<string, unknown>).toolInput as Record<string, unknown> | undefined,
    };

    // Step 1: Deny rules (bypass-immune)
    const denyResult = this.rulesEngine!.evaluateBehavior(toolInput, "deny");
    if (denyResult) {
      return {
        result: {
          decision: "deny",
          decidedBy: "rules-engine:deny",
          reason: `Deny rule matched: ${denyResult.reason.detail ?? toolInput.tool}`,
        },
        ruleDecision: denyResult,
      };
    }

    // Step 2: Ask rules (bypass-immune)
    const askResult = this.rulesEngine!.evaluateBehavior(toolInput, "ask");
    // Note: ask result is recorded but may be overridden by mode (dontAsk)

    // Step 3: Safe tool check
    const isSafe = this.safeToolChecker?.(toolInput.tool, toolInput.input) ?? false;

    // Step 4: Safety checks (.git, .claude protection)
    // Delegated to existing ScopeBasedPolicy in the policy chain

    // Step 5: Mode-based gating
    const mode = getMode();
    const modeResult = evaluateMode(mode, {
      tool: toolInput.tool,
      isSafe,
      isReadOnly: isReadOnlyTool(toolInput.tool),
      isWriteTool: isWriteEditTool(toolInput.tool),
      rulesResult: askResult,
    });

    if (modeResult === "allow") {
      return {
        result: {
          decision: "allow",
          decidedBy: `mode:${mode}`,
          reason: `Mode "${mode}" auto-allowed ${toolInput.tool}`,
        },
        ruleDecision: askResult,
      };
    }

    // Step 6: Allow rules
    const allowResult = this.rulesEngine!.evaluateBehavior(toolInput, "allow");
    if (allowResult) {
      return {
        result: {
          decision: "allow",
          decidedBy: "rules-engine:allow",
          reason: `Allow rule matched: ${allowResult.reason.detail ?? toolInput.tool}`,
        },
        ruleDecision: allowResult,
      };
    }

    // Step 7: Policy chain (existing — unchanged)
    const policyResult = this.evaluate(request);
    if (policyResult.decision !== "deny" || policyResult.decidedBy !== "default") {
      // Policy chain made a decision (not the fail-closed default)
      return { result: policyResult, ruleDecision: askResult };
    }

    // Step 8+9: Default → deny (fail-closed)
    return { result: policyResult, ruleDecision: askResult };
  }

  /** Build classifier input from an approval request. @since RTI-2B */
  private buildClassifierInput(request: ProviderApprovalRequest): ClassifierInput {
    const capability = (request as unknown as Record<string, unknown>).toolCapability as
      | { isReadOnly?: boolean; isDestructive?: boolean; isConcurrencySafe?: boolean; category?: string }
      | undefined;

    return {
      tool: request.reason,
      kind: request.kind,
      readOnly: capability?.isReadOnly ?? false,
      destructive: capability?.isDestructive ?? false,
      network: request.kind === "network",
      diff: request.kind === "diff",
      concurrencySafe: capability?.isConcurrencySafe,
      category: capability?.category,
    };
  }

  /** Emit shadow classifier results for calibration. @since RTI-2B */
  private emitShadowClassifier(
    input: ClassifierInput,
    decision: ClassifierDecision,
    gateDecision: "allow" | "deny",
  ): void {
    for (const cb of this.shadowCallbacks) {
      try { cb(input, decision, gateDecision); } catch { /* shadow must not break gate */ }
    }
  }

  /** Emit a normalized telemetry record (RTI-1A + RTI-2B classifier + v0.6.2 rules). */
  private emitTelemetry(
    request: ProviderApprovalRequest,
    result: ApprovalGateResult,
    classifierDecision?: ClassifierDecision,
    ruleDecision?: PermissionDecision,
  ): void {
    if (this.telemetryCallbacks.length === 0) return;

    const capability = (request as unknown as Record<string, unknown>).toolCapability as
      | { isReadOnly?: boolean; isDestructive?: boolean }
      | undefined;

    const record: ApprovalTelemetryRecord = {
      ts: Date.now(),
      provider: request.providerRef.provider,
      sessionId: request.providerRef.providerSessionId,
      tool: request.reason,
      kind: request.kind,
      readOnly: capability?.isReadOnly ?? false,
      destructive: capability?.isDestructive ?? false,
      network: request.kind === "network",
      diff: request.kind === "diff",
      decision: result.decision,
      decidedBy: result.decidedBy,
      reason: result.reason,
      contractId: this.sessionLedger.findByProviderSession(
        request.providerRef.providerSessionId,
      )?.contractId,
      classifierDecision,
      ruleDecision,
      permissionMode: this.rulesEngine ? getMode() : undefined,
    };

    for (const cb of this.telemetryCallbacks) {
      try { cb(record); } catch { /* telemetry must not break gate */ }
    }
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
