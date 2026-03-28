/**
 * Direct (non-mux) provider CLI execution.
 *
 * Spawns a provider process and optionally captures its output.
 * For mux-based execution, see the mux module (ORC-13).
 */

import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { resolveProviderBinary } from "./provider-binary.js";

/** Options for runProviderCLI. */
export interface ProviderCLIOptions {
  /** Provider name (claude, codex, gemini, etc.). Resolved to binary path. */
  provider: string;
  /** CLI arguments to pass to the provider binary. */
  args: string[];
  /** Working directory for the spawned process. */
  cwd: string;
  /**
   * stdio configuration:
   * - "inherit": user sees output directly (interactive)
   * - "pipe": capture output and return it
   * Defaults to "inherit".
   */
  stdio?: "inherit" | "pipe";
  /** Timeout in milliseconds. Defaults to 300_000 (5 minutes). */
  timeout?: number;
  /** Extra environment variables merged with process.env. */
  env?: Record<string, string>;
}

/** Result from a provider CLI execution. */
export interface ProviderCLIResult {
  /** stdout content (only when stdio is "pipe"). */
  stdout: string;
  /** Process exit code (null if killed by signal). */
  exitCode: number | null;
}

/**
 * Spawn a provider CLI process synchronously.
 *
 * - Resolves the provider binary via core/cli-runner.mjs
 * - Supports "inherit" (interactive) and "pipe" (capture) modes
 * - Returns captured output when using "pipe" mode
 */
export async function runProviderCLI(opts: ProviderCLIOptions): Promise<ProviderCLIResult> {
  const bin = await resolveProviderBinary(opts.provider);
  const mode = opts.stdio ?? "inherit";
  const timeout = opts.timeout ?? 300_000;

  const spawnOpts = {
    cwd: opts.cwd,
    stdio: mode === "pipe"
      ? ["pipe" as const, "pipe" as const, "inherit" as const]
      : "inherit" as const,
    env: { ...process.env, ...opts.env },
    timeout,
    ...(mode === "pipe" ? { encoding: "utf8" as const } : {}),
  };

  const result: SpawnSyncReturns<string | Buffer> = spawnSync(bin, opts.args, spawnOpts);

  return {
    stdout: typeof result.stdout === "string" ? result.stdout : (result.stdout?.toString("utf8") ?? ""),
    exitCode: result.status,
  };
}
