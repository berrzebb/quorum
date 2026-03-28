#!/usr/bin/env node
/**
 * Facade — main implementation at platform/core/retrospective.mjs
 *
 * All exports are re-exported unchanged. No import paths in consumers need updating.
 * Script execution is forwarded to the canonical implementation.
 */

export { main } from "../platform/core/retrospective.mjs";

// ── Script entry point ──
// Original called main() unconditionally at module level.
// Facade preserves this: when spawned as `node core/retrospective.mjs`, main() runs.
const { main: run } = await import("../platform/core/retrospective.mjs");

run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`retrospective marker failed: ${message}`);
  process.exit(1);
});
