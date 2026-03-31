/**
 * Claude SDK Tool Bridge — implements ProviderToolBridge.
 *
 * Normalizes quorum's deterministic tools for Claude SDK's native tool loop.
 * Optional dependency: @anthropic-ai/claude-agent-sdk.
 * Returns fallback config if SDK is not installed.
 *
 * Control-plane integration (SDK-13):
 * - Uses tool capability registry (SDK-5) instead of hardcoded tool list
 * - buildToolSurface() for role/domain-based tool filtering
 * - getCapability() for per-tool metadata (isReadOnly, isDestructive, etc.)
 *
 * @module providers/claude-sdk/tool-bridge
 */

import type { ProviderToolBridge } from "../session-runtime.js";
import {
  allToolNames,
  buildToolSurface,
  getCapability,
} from "../../core/tools/capability-registry.js";

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
 *
 * Control-plane integration:
 * - getAvailableTools() delegates to tool capability registry (canonical source)
 * - buildToolConfig() uses buildToolSurface() for role/domain-based filtering
 * - Each tool entry includes capability metadata (isReadOnly, isDestructive, etc.)
 */
export class ClaudeSdkToolBridge implements ProviderToolBridge {
  readonly provider = "claude" as const;

  constructor(private readonly config: ClaudeToolBridgeConfig) {}

  /**
   * Build the tool configuration for Claude SDK runtime.
   * If SDK is not available, returns fallback config indicating CLI exec mode.
   *
   * When role/domain info is available in config, uses buildToolSurface()
   * for intelligent tool filtering. Otherwise falls back to allowedTools list.
   */
  async buildToolConfig(input: {
    repoRoot: string;
    contractId?: string;
    allowedTools: string[];
    role?: string;
    domains?: string[];
  }): Promise<Record<string, unknown>> {
    const sdkResult = await loadClaudeSdk();

    if (!sdkResult.available) {
      return {
        available: false,
        fallback: "cli_exec",
        reason: sdkResult.error || "Claude Agent SDK not installed",
      };
    }

    // Use buildToolSurface for role/domain-based filtering when available
    let toolNames = input.allowedTools;
    let deferred: string[] = [];
    let env: Record<string, string> = {};

    if (input.role) {
      const surface = buildToolSurface(input.role, input.domains);
      toolNames = surface.tools;
      deferred = surface.deferred;
      env = surface.env;
    }

    // Build tool definitions with capability metadata
    const tools = toolNames.map((name) => {
      const cap = getCapability(name);
      return {
        name,
        type: "quorum_deterministic",
        source: "platform/core/tools",
        ...(cap ? {
          isReadOnly: cap.isReadOnly,
          isDestructive: cap.isDestructive,
          isConcurrencySafe: cap.isConcurrencySafe,
          category: cap.category,
        } : {}),
      };
    });

    return {
      available: true,
      provider: "claude",
      mode: "agent_sdk",
      tools,
      deferred,
      env,
      repoRoot: input.repoRoot,
      contractId: input.contractId,
      useMcpServer: this.config.useMcpServer,
    };
  }

  /**
   * Get the list of quorum deterministic tools available for bridge.
   * Delegates to the canonical tool capability registry (SDK-5).
   */
  static getAvailableTools(): string[] {
    return allToolNames();
  }
}
