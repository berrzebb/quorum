/**
 * Provider binary resolution and CLI argument construction.
 *
 * Wraps core/cli-runner.mjs `resolveBinary` with provider-aware defaults
 * and builds CLI argument arrays for claude/codex/gemini.
 */

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Cached resolveBinary function (loaded once from core/cli-runner.mjs). */
let _resolveBinary: ((cmd: string, envVar?: string) => string) | null = null;

async function getResolveBinary(): Promise<(cmd: string, envVar?: string) => string> {
  if (_resolveBinary) return _resolveBinary;
  // At runtime: dist/platform/orchestrate/core/ → up 4 → project root
  const quorumRoot = resolve(__dirname, "..", "..", "..", "..");
  const mod = await import(pathToFileURL(resolve(quorumRoot, "platform", "core", "cli-runner.mjs")).href);
  _resolveBinary = mod.resolveBinary;
  return _resolveBinary!;
}

/**
 * Resolve the absolute path to a provider's CLI binary.
 * Delegates to core/cli-runner.mjs resolveBinary for cross-platform PATH + PATHEXT handling.
 */
export async function resolveProviderBinary(provider: string): Promise<string> {
  const resolveBin = await getResolveBinary();
  return resolveBin(provider);
}

/** Options for building provider CLI arguments. */
export interface ProviderArgsOptions {
  prompt: string;
  systemPrompt?: string;
  model?: string;
  /** If true, use non-interactive mode (-p for claude). */
  nonInteractive?: boolean;
  dangerouslySkipPermissions?: boolean;
  /** Output format (e.g. "stream-json"). Only for claude. */
  outputFormat?: string;
  /** Codex: --full-auto flag. */
  fullAuto?: boolean;
  /** Max turns (provider-specific). */
  maxTurns?: number;
}

/**
 * Build CLI argument array for a given provider.
 *
 * Claude:  -p <prompt> --append-system-prompt <sys> --dangerously-skip-permissions [--model X]
 * Codex:   --instructions <sys> [--full-auto]
 * Others:  --system-prompt <sys>
 */
export function buildProviderArgs(provider: string, opts: ProviderArgsOptions): string[] {
  const args: string[] = [];

  if (provider === "claude") {
    if (opts.nonInteractive) {
      args.push("-p", opts.prompt);
      if (opts.systemPrompt) args.push("--append-system-prompt", opts.systemPrompt);
      if (opts.dangerouslySkipPermissions) args.push("--dangerously-skip-permissions");
    } else {
      if (opts.systemPrompt) args.push("--append-system-prompt", opts.systemPrompt);
      args.push(opts.prompt);
    }
    if (opts.model) args.push("--model", opts.model);
    if (opts.outputFormat) args.push("--output-format", opts.outputFormat);
  } else if (provider === "codex") {
    if (opts.systemPrompt) args.push("--instructions", opts.systemPrompt);
    if (opts.fullAuto) args.push("--full-auto");
  } else {
    // gemini, ollama, vllm, etc.
    if (opts.systemPrompt) args.push("--system-prompt", opts.systemPrompt);
  }

  return args;
}
