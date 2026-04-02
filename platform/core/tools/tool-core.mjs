/**
 * tool-core.mjs — Re-export shim for all MCP tool functions.
 *
 * After SPLIT-2/3/4, all tool implementations live in individual
 * directories under platform/core/tools/{tool-name}/index.mjs.
 * This file re-exports everything for backward compatibility.
 *
 * Shared utilities live in tool-utils.mjs.
 * FVM tools live in fvm-generator.mjs and fvm-validator.mjs.
 */

// ═══ Shared utilities (from tool-utils.mjs) ════════════════════════════
import {
  PATTERNS,
  findEndLine,
  parseFile,
  walkDir,
  walkDirAsync,
  runPatternScan,
} from "./tool-utils.mjs";

export {
  PATTERNS,
  findEndLine,
  parseFile,
  walkDir,
  walkDirAsync,
  runPatternScan,
};

// ═══ SPLIT-2: Code analysis tools ══════════════════════════════════════
import { toolCodeMap } from "./code-map/index.mjs";
import { toolAuditScan } from "./audit-scan/index.mjs";
import { toolCoverageMap } from "./coverage-map/index.mjs";
import { toolDependencyGraph, buildRawGraph } from "./dependency-graph/index.mjs";
import { toolBlastRadius, computeBlastRadiusFromGraph, computeBlastRadius } from "./blast-radius/index.mjs";
import { toolPerfScan } from "./perf-scan/index.mjs";
import { toolA11yScan } from "./a11y-scan/index.mjs";
import { toolObservabilityCheck } from "./observability-check/index.mjs";

export { toolCodeMap };
export { toolAuditScan };
export { toolCoverageMap };
export { toolDependencyGraph, buildRawGraph };
export { toolBlastRadius, computeBlastRadiusFromGraph, computeBlastRadius };
export { toolPerfScan };
export { toolA11yScan };
export { toolObservabilityCheck };

// ═══ SPLIT-3: RTM/doc/domain tools ════════════════════════════════════
import { toolRtmMerge } from "./rtm-merge/index.mjs";
import { toolRtmParse } from "./rtm-parse/index.mjs";
import { toolDocCoverage, _LEGACY_EXPORT_RE, _LEGACY_JSDOC_START, EXPORT_RE, JSDOC_START } from "./doc-coverage/index.mjs";
import { toolBlueprintLint } from "./blueprint-lint/index.mjs";
import { toolContractDrift } from "./contract-drift/index.mjs";
import { toolLicenseScan, PII_PATTERNS } from "./license-scan/index.mjs";
import { toolCompatCheck, COMPAT_PATTERNS } from "./compat-check/index.mjs";
import { toolI18nValidate, HARDCODED_RE } from "./i18n-validate/index.mjs";

export { toolRtmMerge };
export { toolRtmParse };
export { toolDocCoverage, _LEGACY_EXPORT_RE, _LEGACY_JSDOC_START, EXPORT_RE, JSDOC_START };
export { toolBlueprintLint };
export { toolContractDrift };
export { toolLicenseScan, PII_PATTERNS };
export { toolCompatCheck, COMPAT_PATTERNS };
export { toolI18nValidate, HARDCODED_RE };

// ═══ SPLIT-4: Remaining tools ══════════════════════════════════════════
import { toolAuditHistory } from "./audit-history/index.mjs";
import { toolActAnalyze } from "./act-analyze/index.mjs";
import { toolInfraScan } from "./infra-scan/index.mjs";
import { toolAiGuide } from "./ai-guide/index.mjs";
import { toolAgentComm } from "./agent-comm/index.mjs";
import { toolAuditSubmit } from "./audit-submit/index.mjs";
import { toolSkillSync } from "./skill-sync/index.mjs";
import { toolTrackArchive } from "./track-archive/index.mjs";

export { toolAuditHistory };
export { toolActAnalyze };
export { toolInfraScan };
export { toolAiGuide };
export { toolAgentComm };
export { toolAuditSubmit };
export { toolSkillSync };
export { toolTrackArchive };

// ═══ FVM tools (already separate files) ═══════════════════════════════
import { generateFvm } from "./fvm-generator.mjs";
import { runFvmValidation } from "./fvm-validator.mjs";

export { generateFvm, runFvmValidation };

// ═══ Tool name registry ═══════════════════════════════════════════════

export const TOOL_NAMES = [
  "code_map", "audit_scan", "coverage_map",
  "dependency_graph", "blast_radius", "rtm_parse", "rtm_merge",
  "audit_history", "fvm_generate", "fvm_validate",
  "act_analyze",
  // Specialist domain tools
  "perf_scan", "compat_check", "a11y_scan", "license_scan",
  "i18n_validate", "infra_scan", "observability_check", "doc_coverage",
  // Enforcement tools
  "blueprint_lint",
  // Synthesis tools
  "ai_guide",
  // Agent communication
  "agent_comm",
];
