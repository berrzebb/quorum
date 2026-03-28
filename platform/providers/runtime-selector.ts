import type { ProviderExecutionMode } from "./session-runtime.js";

/**
 * Provider runtime configuration (from config.json or CLI flags).
 */
export interface ProviderRuntimeConfig {
  codex: {
    mode: ProviderExecutionMode;
    binary?: string;
    timeout?: number;
  };
  claude: {
    mode: ProviderExecutionMode;
    binary?: string;
    timeout?: number;
  };
}

/**
 * Default runtime config — cli_exec for both providers.
 */
export function defaultRuntimeConfig(): ProviderRuntimeConfig {
  return {
    codex: { mode: "cli_exec" },
    claude: { mode: "cli_exec" },
  };
}

/**
 * Resolve the effective execution mode for a provider.
 * Applies fallback logic: if requested mode's dependency is missing,
 * fall back to cli_exec.
 */
export function resolveExecutionMode(
  provider: "codex" | "claude",
  requested: ProviderExecutionMode,
  capabilities: { codexBinaryAvailable?: boolean; claudeSdkAvailable?: boolean }
): { mode: ProviderExecutionMode; fallback: boolean; reason?: string } {
  if (requested === "cli_exec") {
    return { mode: "cli_exec", fallback: false };
  }

  if (provider === "codex" && requested === "app_server") {
    if (!capabilities.codexBinaryAvailable) {
      return {
        mode: "cli_exec",
        fallback: true,
        reason: "Codex binary not available for app_server mode",
      };
    }
    return { mode: "app_server", fallback: false };
  }

  if (provider === "claude" && requested === "agent_sdk") {
    if (!capabilities.claudeSdkAvailable) {
      return {
        mode: "cli_exec",
        fallback: true,
        reason: "Claude Agent SDK not installed for agent_sdk mode",
      };
    }
    return { mode: "agent_sdk", fallback: false };
  }

  // Invalid mode for provider
  return {
    mode: "cli_exec",
    fallback: true,
    reason: `Invalid mode ${requested} for provider ${provider}`,
  };
}

/**
 * Merge user config with defaults.
 */
export function mergeRuntimeConfig(
  partial?: Partial<ProviderRuntimeConfig>
): ProviderRuntimeConfig {
  const defaults = defaultRuntimeConfig();
  if (!partial) return defaults;

  return {
    codex: { ...defaults.codex, ...partial.codex },
    claude: { ...defaults.claude, ...partial.claude },
  };
}

/**
 * Check if a feature flag enables a non-default runtime mode.
 */
export function isSessionRuntimeEnabled(config: ProviderRuntimeConfig): boolean {
  return config.codex.mode !== "cli_exec" || config.claude.mode !== "cli_exec";
}
