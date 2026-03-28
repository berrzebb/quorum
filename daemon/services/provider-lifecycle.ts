/**
 * Provider lifecycle service — handles provider registration and cleanup.
 * Extracted from daemon/index.ts to isolate provider concerns.
 *
 * Responsibilities:
 * - Register providers with the global registry
 * - Start providers with bus + config
 * - Stop all providers on shutdown
 */

import { ClaudeCodeProvider } from "../../platform/providers/claude-code/adapter.js";
import { registerProvider, listProviders } from "../../platform/providers/provider.js";
import type { ProviderConfig } from "../../platform/providers/provider.js";
import type { QuorumBus } from "../../platform/bus/bus.js";

// ── Types ────────────────────────────────────────────────────────────

export interface ProviderLifecycleResult {
  /** Stop all registered providers. */
  cleanup: () => Promise<void>;
}

// ── Provider Start/Stop ──────────────────────────────────────────────

/**
 * Register and start all providers.
 * Currently only ClaudeCodeProvider — extensible for codex, gemini, etc.
 */
export async function startProviders(bus: QuorumBus, config: ProviderConfig): Promise<ProviderLifecycleResult> {
  const claude = new ClaudeCodeProvider();
  registerProvider(claude);
  await claude.start(bus, config);

  return {
    cleanup: async () => {
      for (const provider of listProviders()) {
        await provider.stop();
      }
    },
  };
}
