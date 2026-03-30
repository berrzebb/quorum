/**
 * Claude SDK Tool Bridge — implements ProviderToolBridge.
 *
 * Normalizes quorum's deterministic tools for Claude SDK's native tool loop.
 * Optional dependency: @anthropic-ai/claude-agent-sdk.
 * Returns fallback config if SDK is not installed.
 *
 * @module providers/claude-sdk/tool-bridge
 */

import type { ProviderToolBridge } from "../session-runtime.js";

/**
 * Checks if the Claude Agent SDK is available as an optional dependency.
 */
export function isClaudeSdkAvailable(): boolean {
  try {
    require.resolve("@anthropic-ai/claude-agent-sdk");
    return true;
  } catch (err) {
    console.warn(`[tool-bridge] Claude Agent SDK not available: ${(err as Error).message}`);
    return false;
  }
}

/**
 * Result of attempting to load the Claude SDK.
 */
export interface ClaudeSdkLoadResult {
  available: boolean;
  sdk?: unknown;
  error?: string;
}

/**
 * Attempt to dynamically load the Claude Agent SDK.
 */
export async function loadClaudeSdk(): Promise<ClaudeSdkLoadResult> {
  try {
    // Dynamic import — optional dependency, not installed in most environments
    const modName = "@anthropic-ai/claude-agent-sdk";
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const sdk = await (Function("m", "return import(m)")(modName) as Promise<unknown>);
    return { available: true, sdk };
  } catch (err) {
    return {
      available: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Configuration for the Claude SDK tool bridge.
 */
export interface ClaudeToolBridgeConfig {
  /** Quorum tool names to expose to the SDK */
  allowedTools: string[];
  /** Whether to use createSdkMcpServer() for tool exposure */
  useMcpServer: boolean;
  /** Repository root path */
  repoRoot: string;
  /** Contract ID for scope enforcement */
  contractId?: string;
}

/**
 * Maps a quorum tool name to its SDK-compatible definition.
 */
export interface SdkToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/**
 * Claude SDK Tool Bridge — implements ProviderToolBridge.
 * Normalizes quorum's deterministic tools for Claude SDK's native tool loop.
 */
export class ClaudeSdkToolBridge implements ProviderToolBridge {
  readonly provider = "claude" as const;

  constructor(private readonly config: ClaudeToolBridgeConfig) {}

  /**
   * Build the tool configuration for Claude SDK runtime.
   * If SDK is not available, returns fallback config indicating CLI exec mode.
   */
  async buildToolConfig(input: {
    repoRoot: string;
    contractId?: string;
    allowedTools: string[];
  }): Promise<Record<string, unknown>> {
    const sdkResult = await loadClaudeSdk();

    if (!sdkResult.available) {
      return {
        available: false,
        fallback: "cli_exec",
        reason: sdkResult.error || "Claude Agent SDK not installed",
      };
    }

    // Build tool definitions for allowed tools
    const tools = input.allowedTools.map((name) => ({
      name,
      type: "quorum_deterministic",
      source: "platform/core/tools",
    }));

    return {
      available: true,
      provider: "claude",
      mode: "agent_sdk",
      tools,
      repoRoot: input.repoRoot,
      contractId: input.contractId,
      useMcpServer: this.config.useMcpServer,
    };
  }

  /**
   * Get the list of quorum deterministic tools available for bridge.
   */
  static getAvailableTools(): string[] {
    return [
      "code_map",
      "blast_radius",
      "audit_scan",
      "dependency_graph",
      "perf_scan",
      "a11y_scan",
      "license_scan",
      "observability_check",
      "compat_check",
      "i18n_validate",
      "infra_scan",
      "coverage_map",
      "fvm_generate",
      "fvm_validate",
      "rtm_parse",
      "rtm_merge",
      "doc_coverage",
      "blueprint_lint",
      "contract_drift",
      "ai_guide",
    ];
  }
}
