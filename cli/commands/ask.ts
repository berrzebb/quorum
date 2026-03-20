/**
 * quorum ask <provider> "<prompt>" — query a provider directly.
 *
 * Similar to OMC's `omc ask codex` or Ouroboros's agent invocation.
 * Spawns the provider CLI and pipes the prompt.
 */

import { spawnSync } from "node:child_process";

const PROVIDER_BINS: Record<string, { bin: string; args: (prompt: string) => string[] }> = {
  codex: {
    bin: "codex",
    args: (prompt) => ["exec", prompt],
  },
  claude: {
    bin: "claude",
    args: (prompt) => ["-p", prompt],
  },
  gemini: {
    bin: "gemini",
    args: (prompt) => ["-p", prompt],
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

  const result = spawnSync(config.bin, config.args(prompt), {
    stdio: "inherit",
    cwd: process.cwd(),
    env: { ...process.env },
    shell: process.platform === "win32",
  });

  if (result.error) {
    console.error(`\n\x1b[31m✗ ${config.bin} not found. Is it installed?\x1b[0m\n`);
    process.exit(1);
  }

  process.exit(result.status ?? 0);
}
