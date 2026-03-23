#!/usr/bin/env node
/**
 * Backward-compatible shim — delegates to core/audit/index.mjs.
 *
 * Any external code that imports from "core/audit.mjs" will get the same
 * public surface.  When executed directly (`node core/audit.mjs`), the
 * side-effect `main()` inside index.mjs runs as before.
 */
export { stampAuditCompleted, initPaths, runRespond, deriveAuditCwd } from "./audit/index.mjs";
export { parseArgs, usage } from "./audit/args.mjs";
export { readSavedSession, writeSavedSession, deleteSavedSessionId, getSessionPath, sessionKVKey, initSessionDir } from "./audit/session.mjs";
export { hasPendingItems, detectScope, readSectionLines, loadPromotionHint, buildPromotionSection, checkEslintCoverage, extractChangedFilesFromEvidence, extractTestCommands } from "./audit/scope.mjs";
export { runPreVerification, runTscLocally, runEslintLocally, runTestsLocally, computeChangedFiles } from "./audit/pre-verify.mjs";
export { resolveCodexBin, determineResumeTarget, buildCodexArgs, streamCodexOutput } from "./audit/codex-runner.mjs";
export { generateSoloVerdict } from "./audit/solo-verdict.mjs";
