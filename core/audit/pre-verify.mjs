/**
 * Facade — delegates to platform/core/audit/pre-verify.mjs (canonical location).
 */
export {
  runPreVerification,
  runTscLocally,
  runEslintLocally,
  runTestsLocally,
  computeChangedFiles,
} from "../../platform/core/audit/pre-verify.mjs";
