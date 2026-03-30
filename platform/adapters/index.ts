// platform/adapters — 4 adapter implementations + shared business logic (all MJS)
// Adapters: claude-code, codex, gemini, openai-compatible
// Shared: 20 MJS modules in shared/ (hook-runner, cli-adapter, ndjson-parser, etc.)
// No TS exports — adapters are MJS-only (loaded at runtime via hooks.json).

export const ADAPTER_NAMES = [
  "claude-code", "codex", "gemini", "openai-compatible",
] as const;

export type AdapterName = typeof ADAPTER_NAMES[number];
