#!/usr/bin/env node
/**
 * Facade — main implementation at platform/core/respond.mjs
 *
 * All exports are re-exported unchanged. No import paths in consumers need updating.
 * Script execution is forwarded to the canonical implementation.
 */

import { fileURLToPath } from "node:url";

export { main } from "../platform/core/respond.mjs";

// ── Script entry point ──
// When invoked directly (node core/respond.mjs), delegate to canonical main().
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { main } = await import("../platform/core/respond.mjs");
  main().catch(error => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`respond failed: ${message}`);
    process.exit(1);
  });
}
