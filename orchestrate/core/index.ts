// Core layer — provider binary, mux, git, repo paths

export { resolveProviderBinary, buildProviderArgs } from './provider-binary.js';
export type { ProviderArgsOptions } from './provider-binary.js';
export { runProviderCLI } from './provider-cli.js';
export type { ProviderCLIOptions, ProviderCLIResult } from './provider-cli.js';

// Mux backend — detection and instantiation
export { detectMuxBackend } from './mux-backend.js';
export type { MuxBackend, MuxBackendResult } from './mux-backend.js';

// Mux session — lifecycle management (spawn, poll, cleanup)
export { spawnMuxSession, pollMuxCompletion, cleanupMuxSession } from './mux-session.js';
export type { MuxSpawnOptions, MuxSessionHandle } from './mux-session.js';

// Prompt file I/O
export { writePromptFile, writeScriptFile, cleanupPromptFiles } from './prompt-files.js';
