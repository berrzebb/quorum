/**
 * quorum ask <provider> "<prompt>" — query a provider directly.
 *
 * Similar to OMC's `omc ask codex` or Ouroboros's agent invocation.
 * Spawns the provider CLI and pipes the prompt.
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { extname, join, isAbsolute, delimiter } from "node:path";

/** Resolve binary: on Windows, prefer .cmd/.exe/.bat over extensionless POSIX scripts. */
function resolveWinBinary(command: string, envVar?: string): string {
  const override = envVar ? process.env[envVar] : undefined;
  if (override) return override;
  if (process.platform !== "win32") return command;

  const exts = (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").map(e => e.trim().toLowerCase()).filter(Boolean);
  const dirs = (process.env.PATH ?? "").split(delimiter).filter(Boolean);

  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = join(dir, `${command}${ext}`);
      if (existsSync(candidate)) return candidate;
    }
  }
  return command;
}

// stdin: true means prompt is passed via stdin (not argv) to avoid shell interpretation
const PROVIDER_BINS: Record<string, { bin: string; args: () => string[]; stdin: boolean }> = {
  codex: {
    bin: resolveWinBinary("codex", "CODEX_BIN"),
    args: () => ["exec", "-"],
    stdin: true,
  },
  claude: {
    bin: resolveWinBinary("claude"),
    args: () => ["-p", "-"],
    stdin: true,
  },
  gemini: {
    bin: resolveWinBinary("gemini"),
    args: () => ["-p", "-"],
    stdin: true,
  },
};

export async function run(args: string[]): Promise<void> {
  const provider = args[0];
  const prompt = args.slice(1).join(" ");

  if (!provider || !prompt) {
    console.log(`
\x1b[36mquorum ask\x1b[0m — query a provider directly

\x1b[1mUsage:\x1b[0m quorum ask <provider> "<prompt>"

\x1b[1mProviders:\x1b[0m
  codex    OpenAI Codex CLI
  claude   Anthropic Claude CLI
  gemini   Google Gemini CLI

\x1b[1mExamples:\x1b[0m
  quorum ask codex "review the auth middleware for security issues"
  quorum ask claude "explain the audit protocol in this codebase"
  quorum ask gemini "suggest optimizations for the event bus"
`);
    return;
  }

  const config = PROVIDER_BINS[provider];
  if (!config) {
    console.error(`\x1b[31mUnknown provider: ${provider}\x1b[0m`);
    console.error(`Available: ${Object.keys(PROVIDER_BINS).join(", ")}\n`);
    process.exit(1);
  }

  console.log(`\x1b[2m[quorum] Asking ${provider}...\x1b[0m\n`);

  // Prompt is passed via stdin to avoid shell interpretation risk on .cmd wrappers
  const needsShell = process.platform === "win32" && /\.(cmd|bat)$/i.test(config.bin);
  const result = spawnSync(config.bin, config.args(), {
    input: config.stdin ? prompt : undefined,
    stdio: config.stdin ? ["pipe", "inherit", "inherit"] : "inherit",
    cwd: process.cwd(),
    env: { ...process.env },
    shell: needsShell,
  });

  if (result.error) {
    console.error(`\n\x1b[31m✗ ${config.bin} not found. Is it installed?\x1b[0m\n`);
    process.exit(1);
  }

  process.exit(result.status ?? 0);
}
