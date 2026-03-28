/**
 * Facade — delegates to platform/core/audit/scope.mjs (canonical location).
 */
export {
  hasPendingItems,
  detectScope,
  readSectionLines,
  loadPromotionHint,
  buildPromotionSection,
  checkEslintCoverage,
  extractChangedFilesFromEvidence,
  extractTestCommands,
} from "../../platform/core/audit/scope.mjs";
