import type { ProviderExecutionMode } from "./session-runtime.js";

// ── Runtime Selection Policy (SDK-16) ────────────────────
//
// 1. DEFAULT: cli_exec for both providers (one-shot audit).
//    This is the stable production path with no external dependencies.
//
// 2. UPGRADE PATH:
//    - claude: cli_exec → agent_sdk (requires @anthropic-ai/claude-agent-sdk peer dep)
//
// 3. FALLBACK GUARANTEE: if the requested mode's dependency is missing,
//    resolveExecutionMode() silently falls back to cli_exec.
//    Consumer code never needs mode-specific error handling.
//
// 4. OPTIONAL DEPENDENCIES (none required for default behavior):
//    - @anthropic-ai/claude-agent-sdk: for agent_sdk mode only
//    - codex-plugin-cc: for broker-based auditing
//    - revfactory/harness: for team generation meta-skill
//
// 5. PRODUCTION BOUNDARIES:
//    - cli_exec: safe for all environments (subprocess + one-shot)
//    - agent_sdk: requires in-process SDK (memory budget consideration)
//
// Config source priority: CLI flags > config.json runtime section > defaults

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

// ── SDK-16: Config validation + policy description ──────

/** Valid modes per provider. */
const VALID_MODES: Record<"codex" | "claude", ProviderExecutionMode[]> = {
  codex: ["cli_exec"],
  claude: ["cli_exec", "agent_sdk"],
};

/**
 * Validate a runtime config. Returns warnings (not errors) since
 * resolveExecutionMode handles fallback at runtime.
 */
export function validateRuntimeConfig(config: ProviderRuntimeConfig): string[] {
  const warnings: string[] = [];

  if (!VALID_MODES.codex.includes(config.codex.mode)) {
    warnings.push(`codex.mode "${config.codex.mode}" is not valid (expected: ${VALID_MODES.codex.join(", ")}). Will fall back to cli_exec.`);
  }
  if (!VALID_MODES.claude.includes(config.claude.mode)) {
    warnings.push(`claude.mode "${config.claude.mode}" is not valid (expected: ${VALID_MODES.claude.join(", ")}). Will fall back to cli_exec.`);
  }

  return warnings;
}

/** Runtime selection policy as structured data (for documentation/tooling). */
export interface RuntimePolicy {
  provider: "codex" | "claude";
  validModes: ProviderExecutionMode[];
  defaultMode: ProviderExecutionMode;
  optionalDependency?: string;
  productionNote: string;
}

/**
 * Describe the runtime selection policy for all providers.
 * Used by CLI `quorum doctor` and documentation generation.
 */
export function describeRuntimePolicy(): RuntimePolicy[] {
  return [
    {
      provider: "codex",
      validModes: ["cli_exec"],
      defaultMode: "cli_exec",
      productionNote: "cli_exec is subprocess-based; safe for all environments.",
    },
    {
      provider: "claude",
      validModes: ["cli_exec", "agent_sdk"],
      defaultMode: "cli_exec",
      optionalDependency: "@anthropic-ai/claude-agent-sdk",
      productionNote: "agent_sdk runs in-process; consider memory budget for large codebases.",
    },
  ];
}
