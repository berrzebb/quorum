#!/usr/bin/env node
/**
 * Facade — delegates to platform/core/audit/index.mjs (canonical location).
 *
 * Named exports are re-exported for library consumers.
 * When executed directly (`node core/audit/index.mjs`), the side-effect
 * main() in the platform copy runs automatically via its top-level await.
 */
export { runRespond, deriveAuditCwd } from "../../platform/core/audit/index.mjs";
