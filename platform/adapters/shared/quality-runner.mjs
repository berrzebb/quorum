/**
 * Shared quality runner — re-exports the generic quality check runner.
 *
 * The actual implementation in adapters/claude-code/run-quality-checks.mjs
 * is already adapter-agnostic (takes config, repoRoot, changedFiles as params).
 * This module provides a stable import path for all adapters.
 */

export { runQualityChecks } from "../../../adapters/claude-code/run-quality-checks.mjs";
