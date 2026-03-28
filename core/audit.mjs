#!/usr/bin/env node
/**
 * Facade — delegates to platform/core/audit.mjs (canonical location).
 *
 * Any external code that imports from "core/audit.mjs" will get the same
 * public surface.  When executed directly (`node core/audit.mjs`), the
 * side-effect `main()` inside platform/core/audit/index.mjs runs as before.
 */
export { runRespond, deriveAuditCwd } from "../platform/core/audit/index.mjs";
export { parseArgs, usage } from "../platform/core/audit/args.mjs";
export { readSavedSession, writeSavedSession, deleteSavedSessionId, getSessionPath, sessionKVKey, initSessionDir } from "../platform/core/audit/session.mjs";
export { hasPendingItems, detectScope, readSectionLines, loadPromotionHint, buildPromotionSection, checkEslintCoverage, extractChangedFilesFromEvidence, extractTestCommands } from "../platform/core/audit/scope.mjs";
export { runPreVerification, runTscLocally, runEslintLocally, runTestsLocally, computeChangedFiles } from "../platform/core/audit/pre-verify.mjs";
export { resolveCodexBin, determineResumeTarget, buildCodexArgs, streamCodexOutput } from "../platform/core/audit/codex-runner.mjs";
export { generateSoloVerdict } from "../platform/core/audit/solo-verdict.mjs";
