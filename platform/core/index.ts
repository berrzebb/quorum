// platform/core — shared runtime substrate
// Placeholder exports — real modules will be added as they move from root core/
export * from './harness/index.js';
// audit modules are .mjs (Class B/C) — import via platform/core/audit.mjs or platform/core/audit/*.mjs
export * as tools from './tools/index.js';
