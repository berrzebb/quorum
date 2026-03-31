/**
 * Claude SDK Permission Bridge — binds Claude SDK's `permissionMode` and
 * `canUseTool` concepts to quorum's approval gate.
 *
 * Key invariant: provider-native approval NEVER bypasses quorum gate.
 * Even in `bypassPermissions` mode, the quorum gate has final authority
 * when `enforceQuorumGate` is true.
 *
 * Control-plane integration (SDK-13):
 * - Uses tool capability registry for plan mode filtering (isReadOnly)
 * - Uses isDestructive for additional safety in acceptEdits mode
 */

import type {
  ProviderApprovalRequest,
  ProviderSessionRef,
} from "../session-runtime.js";
import type { ProviderApprovalGate, ApprovalGateResult } from "../../bus/provider-approval-gate.js";
import {
  isReadOnly as checkReadOnly,
  isDestructive as checkDestructive,
  isKnownTool,
} from "../../core/tools/capability-registry.js";

// ── Permission mode ──────────────────────────────

/**
 * Claude SDK permission modes (mirrors SDK spec).
 */
export type ClaudePermissionMode = "default" | "acceptEdits" | "bypassPermissions" | "plan";

// ── Config ───────────────────────────────────────

/**
 * Configuration for Claude SDK permission binding.
 */
export interface ClaudePermissionConfig {
  /** Permission mode to apply */
  mode: ClaudePermissionMode;
  /** Settings sources for project-level settings */
  settingSources?: ("project" | "user")[];
  /** Whether to enforce quorum gate on top of SDK permissions */
  enforceQuorumGate: boolean;
}

// ── Result ───────────────────────────────────────

/**
 * Result of a tool permission check.
 */
export interface ToolPermissionResult {
  allowed: boolean;
  reason: string;
  source: "quorum-gate" | "sdk-mode" | "explicit-deny";
}

// ── Read-only tool set for plan mode ─────────────
// Legacy hardcoded set (kept as fallback if registry load fails)
const PLAN_MODE_ALLOWED_TOOLS_FALLBACK = new Set([
  "code_map",
  "blast_radius",
  "dependency_graph",
  "audit_scan",
  "coverage_map",
  "doc_coverage",
]);

// ── ClaudePermissionBridge ────────────────────────

/**
 * Bridges Claude SDK's `canUseTool` callback with quorum's approval gate.
 *
 * Key contract: provider-native approval NEVER bypasses quorum gate.
 * Even in `bypassPermissions` mode, the quorum gate has final authority
 * when `enforceQuorumGate` is true.
 */
export class ClaudePermissionBridge {
  constructor(
    private readonly config: ClaudePermissionConfig,
    private readonly gate: ProviderApprovalGate
  ) {}

  /**
   * Build the `canUseTool` callback for Claude SDK.
   * This is the function passed to the SDK's permissionMode config.
   */
  buildCanUseTool(
    sessionRef: ProviderSessionRef
  ): (toolName: string, input: Record<string, unknown>) => boolean {
    return (toolName: string, _input: Record<string, unknown>): boolean => {
      const result = this.checkToolPermission(toolName, sessionRef);
      return result.allowed;
    };
  }

  /**
   * Check if a tool is allowed by combining SDK mode + quorum gate.
   */
  checkToolPermission(
    toolName: string,
    sessionRef: ProviderSessionRef
  ): ToolPermissionResult {
    // Step 1: Check quorum gate FIRST (always, regardless of SDK mode)
    if (this.config.enforceQuorumGate) {
      const approvalRequest: ProviderApprovalRequest = {
        providerRef: sessionRef,
        requestId: `perm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        kind: "tool",
        reason: toolName,
        scope: [toolName],
      };

      const gateResult: ApprovalGateResult = this.gate.evaluate(approvalRequest);

      if (gateResult.decision === "deny") {
        return {
          allowed: false,
          reason: `Quorum gate denied: ${gateResult.reason}`,
          source: "quorum-gate",
        };
      }

      // Gate allowed — proceed
      return {
        allowed: true,
        reason: `Quorum gate allowed via ${gateResult.decidedBy}`,
        source: "quorum-gate",
      };
    }

    // Step 2: If quorum gate not enforced, fall back to SDK mode logic
    return this.checkSdkModePermission(toolName);
  }

  /**
   * Check permission based on SDK mode alone (used when gate not enforced).
   *
   * Control-plane integration:
   * - plan mode: uses isReadOnly from capability registry (fallback to hardcoded set)
   * - acceptEdits mode: blocks destructive tools via isDestructive from registry
   */
  private checkSdkModePermission(toolName: string): ToolPermissionResult {
    switch (this.config.mode) {
      case "bypassPermissions":
        return { allowed: true, reason: "SDK mode: bypassPermissions", source: "sdk-mode" };

      case "acceptEdits":
        // In acceptEdits, allow non-destructive tools. Block destructive tools.
        if (isKnownTool(toolName) && checkDestructive(toolName)) {
          return { allowed: false, reason: "SDK mode: acceptEdits (destructive tool blocked)", source: "sdk-mode" };
        }
        return { allowed: true, reason: "SDK mode: acceptEdits", source: "sdk-mode" };

      case "plan":
        // In plan mode, only read-only tools are allowed.
        // Use registry-based check; fall back to hardcoded set for unknown tools.
        if (isKnownTool(toolName)) {
          if (checkReadOnly(toolName)) {
            return { allowed: true, reason: "SDK mode: plan (read-only per registry)", source: "sdk-mode" };
          }
          return { allowed: false, reason: "SDK mode: plan (write tool blocked per registry)", source: "sdk-mode" };
        }
        // Unknown tool: fall back to hardcoded set
        if (PLAN_MODE_ALLOWED_TOOLS_FALLBACK.has(toolName)) {
          return { allowed: true, reason: "SDK mode: plan (read-only tool, fallback)", source: "sdk-mode" };
        }
        return { allowed: false, reason: "SDK mode: plan (unknown tool blocked)", source: "sdk-mode" };

      case "default":
      default:
        // Default mode requires explicit approval
        return { allowed: false, reason: "SDK mode: default (requires approval)", source: "sdk-mode" };
    }
  }

  /**
   * Build the permission config for Claude SDK initialization.
   */
  buildSdkPermissionConfig(): Record<string, unknown> {
    return {
      permissionMode: this.config.mode,
      settingSources: this.config.settingSources ?? ["project"],
      quorumGateEnforced: this.config.enforceQuorumGate,
    };
  }

  /**
   * Get the default permission config (most restrictive).
   */
  static defaultConfig(): ClaudePermissionConfig {
    return {
      mode: "default",
      settingSources: ["project"],
      enforceQuorumGate: true,
    };
  }
}
