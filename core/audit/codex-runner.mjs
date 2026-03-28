/**
 * Facade — delegates to platform/core/audit/codex-runner.mjs (canonical location).
 */
export {
  resolveCodexBin,
  determineResumeTarget,
  buildCodexArgs,
  streamCodexOutput,
} from "../../platform/core/audit/codex-runner.mjs";
