/**
 * Auditor Factory — creates Auditor instances from config.
 *
 * Maps provider names to implementations. Supports role-based model selection:
 * { "advocate": "claude:claude-opus-4-6", "devil": "openai:gpt-4o", "judge": "codex" }
 *
 * Format: "provider:model" or just "provider" (uses default model).
 */

import type { Auditor } from "../provider.js";
import { CodexAuditor } from "../codex/auditor.js";
import { ClaudeAuditor } from "./claude.js";
import { OpenAIAuditor } from "./openai.js";
import { GeminiAuditor } from "./gemini.js";

export interface AuditorSpec {
  /** Provider name: "codex", "claude", "openai", "gemini" */
  provider: string;
  /** Model override (optional, provider default if omitted) */
  model?: string;
}

/**
 * Parse a spec string like "openai:gpt-4o" or "codex" into components.
 */
export function parseSpec(spec: string): AuditorSpec {
  const [provider, ...rest] = spec.split(":");
  return {
    provider: provider!,
    model: rest.length > 0 ? rest.join(":") : undefined,
  };
}

/**
 * Create an Auditor instance from a spec string.
 */
export function createAuditor(spec: string, cwd?: string): Auditor {
  const { provider, model } = parseSpec(spec);

  switch (provider) {
    case "codex":
      return new CodexAuditor({ model, cwd });

    case "claude":
      return new ClaudeAuditor({ model, cwd });

    case "openai":
    case "gpt":
      return new OpenAIAuditor({ model });

    case "gemini":
    case "google":
      return new GeminiAuditor({ model });

    default:
      throw new Error(`Unknown auditor provider: ${provider}. Available: codex, claude, openai, gemini`);
  }
}

/**
 * Create a full consensus configuration from role mappings.
 *
 * Example config:
 * {
 *   "advocate": "claude:claude-opus-4-6",
 *   "devil": "openai:gpt-4o",
 *   "judge": "codex"
 * }
 */
export function createConsensusAuditors(
  roles: Record<string, string>,
  cwd?: string,
): { advocate: Auditor; devil: Auditor; judge: Auditor } {
  return {
    advocate: createAuditor(roles.advocate ?? roles.default ?? "codex", cwd),
    devil: createAuditor(roles.devil ?? roles.default ?? "codex", cwd),
    judge: createAuditor(roles.judge ?? roles.default ?? "codex", cwd),
  };
}

/**
 * List all available auditor providers.
 */
export function listAuditorProviders(): string[] {
  return ["codex", "claude", "openai", "gemini"];
}

/**
 * Check availability of all consensus auditors.
 * Returns list of unavailable roles for pre-flight validation.
 */
export async function checkAvailability(
  auditors: { advocate: Auditor; devil: Auditor; judge: Auditor },
  roles?: Record<string, string>,
): Promise<{ allAvailable: boolean; unavailable: Array<{ role: string; provider: string }> }> {
  const checks = await Promise.all(
    (["advocate", "devil", "judge"] as const).map(async (role) => {
      const auditor = auditors[role];
      try {
        const ok = await auditor.available();
        return { role, available: ok };
      } catch {
        return { role, available: false };
      }
    }),
  );

  const unavailable = checks
    .filter(c => !c.available)
    .map(c => ({ role: c.role, provider: roles?.[c.role] ?? c.role }));

  return { allAvailable: unavailable.length === 0, unavailable };
}
