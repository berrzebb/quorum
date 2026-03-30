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
  } else if (provider === "gemini") {
    // Gemini CLI: -p for non-interactive, --yolo for auto-approve, no --system-prompt flag
    const fullPrompt = opts.systemPrompt
      ? `[System: ${opts.systemPrompt}]\n\n${opts.prompt}`
      : opts.prompt;
    args.push("-p", fullPrompt, "--yolo");
  } else {
    // ollama, vllm, etc.
    if (opts.systemPrompt) args.push("--system-prompt", opts.systemPrompt);
    if (opts.prompt) args.push(opts.prompt);
  }

  return args;
}

/** Ready-to-spawn info returned by prepareProviderSpawn. */
export interface ProviderSpawnInfo {
  /** Binary to execute (on Windows, this is cmd.exe). */
  bin: string;
  /** Full args array (on Windows, includes /c <binary>). */
  args: string[];
  /** If set, pipe this to stdin instead of passing prompt as CLI arg. */
  stdinInput?: string;
}

/**
 * Resolve binary, build CLI args, and wrap for Windows in one call.
 *
 * Codex: pipes prompt via stdin (avoids shell escaping issues).
 * Windows: wraps in `cmd /c <binary>` (shell:true corrupts multi-line args).
 */
export async function prepareProviderSpawn(
  provider: string,
  prompt: string,
  opts?: { systemPrompt?: string; dangerouslySkipPermissions?: boolean },
): Promise<ProviderSpawnInfo> {
  const rawBin = await resolveProviderBinary(provider);

  let finalArgs: string[];
  let stdinInput: string | undefined;

  if (provider === "codex") {
    finalArgs = ["exec", "--full-auto", "-"];
    stdinInput = prompt;
  } else if (provider === "gemini") {
    // Gemini: pipe prompt via stdin to avoid Windows cmd.exe length limits.
    // gemini -p reads stdin and appends -p value (use empty -p "").
    const sysPrefix = opts?.systemPrompt ? `[System: ${opts.systemPrompt}]\n\n` : "";
    stdinInput = sysPrefix + prompt;
    finalArgs = ["-p", "", "--yolo"];
  } else {
    finalArgs = buildProviderArgs(provider, {
      prompt,
      systemPrompt: opts?.systemPrompt,
      nonInteractive: true,
      dangerouslySkipPermissions: opts?.dangerouslySkipPermissions ?? true,
      fullAuto: true,
    });
  }

  const isWin = process.platform === "win32";
  const bin = isWin ? (process.env.ComSpec ?? "cmd.exe") : rawBin;
  const args = isWin ? ["/c", rawBin, ...finalArgs] : finalArgs;

  return { bin, args, stdinInput };
}
