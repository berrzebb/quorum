/**
 * AST Analyzer — facade over source-file and program analyzers.
 *
 * v0.6.3 SPLIT: 939-line monolith → facade (~180 lines) + 2 extracted modules.
 * Public API is 100% unchanged — all existing consumers work without modification.
 *
 * Two modes:
 * - sourceFile: fast single-file parsing (<50ms/file), no type checking
 * - program: full ts.createProgram with type checker, for cross-file analysis
 */

import type * as ts from "typescript";
import {
  analyzeFiles as _analyzeFiles,
  refineCandidates as _refineCandidates,
} from "./source-file-analyzer.js";
import {
  initProgram as _initProgram,
  detectUnusedExports as _detectUnusedExports,
  detectImportCycles as _detectImportCycles,
  detectContractDrift as _detectContractDrift,
  analyzeProgram as _analyzeProgram,
} from "./program-analyzer.js";
import type { ProgramState } from "./program-analyzer.js";

// ── Types (re-exported for backward compatibility) ──

export type ASTFindingCategory =
  | "unnecessary-assertion"
  | "required-assertion"
  | "unsafe-loop"
  | "safe-loop"
  | "unreachable-code"
  | "unused-export"
  | "import-cycle"
  | "duplicate-logic"
  | "missing-null-check"
  | "context-false-positive"
  | "contract-redeclaration"
  | "contract-signature-mismatch"
  | "contract-missing-member";

export interface ASTFinding {
  file: string;
  line: number;
  column: number;
  endLine?: number;
  category: ASTFindingCategory;
  severity: "critical" | "high" | "medium" | "low";
  message: string;
  astContext?: string;
  overridesRegex?: boolean;
  regexLabel?: string;
}

export interface FileMetrics {
  avgCyclomaticComplexity: number;
  maxCyclomaticComplexity: number;
  typeAssertionCount: number;
  effectiveLines: number;
  exportCount: number;
}

export interface ASTAnalysisResult {
  file: string;
  findings: ASTFinding[];
  metrics: FileMetrics;
  duration: number;
}

export interface AggregateMetrics {
  totalFiles: number;
  avgComplexity: number;
  maxComplexity: number;
  totalAssertions: number;
  totalEffectiveLines: number;
}

export interface RegexCandidate {
  file: string;
  line: number;
  column?: number;
  regexLabel: string;
  regexSeverity: string;
}

export interface ASTAnalyzerConfig {
  tsconfigPath?: string;
  maxFiles?: number;
  perFileTimeout?: number;
  mode: "sourceFile" | "program";
}

// ── Program-mode types ──────────────────────────────

export interface UnusedExport {
  file: string;
  name: string;
  line: number;
  kind: "function" | "class" | "variable" | "type" | "interface" | "enum" | "other";
}

export interface ImportCycle {
  files: string[];
}

export interface ContractDrift {
  contractFile: string;
  contractName: string;
  kind: "redeclaration" | "signature-mismatch" | "missing-member";
  violationFile: string;
  violationLine: number;
  detail: string;
  severity: "critical" | "high";
}

export interface ProgramAnalysisResult {
  unusedExports: UnusedExport[];
  importCycles: ImportCycle[];
  contractDrifts: ContractDrift[];
  fileCount: number;
  duration: number;
}

// ── Facade ──────────────────────────────────────────

/**
 * AST Analyzer — facade that delegates to source-file-analyzer and program-analyzer.
 *
 * Public API is identical to the pre-SPLIT version.
 */
export class ASTAnalyzer {
  private config: ASTAnalyzerConfig;
  private programState?: ProgramState;

  constructor(config: Partial<ASTAnalyzerConfig> = {}) {
    this.config = {
      mode: "sourceFile",
      maxFiles: 50,
      perFileTimeout: 5000,
      ...config,
    };
  }

  /** Analyze files, producing findings and metrics. */
  analyzeFiles(filePaths: string[]): ASTAnalysisResult[] {
    return _analyzeFiles(filePaths, this.config);
  }

  /** Refine regex candidates with AST context. */
  refineCandidates(candidates: RegexCandidate[]): ASTFinding[] {
    return _refineCandidates(candidates);
  }

  /** Initialize ts.createProgram from a tsconfig.json. */
  initProgram(tsconfigPath?: string): boolean {
    const configPath = tsconfigPath ?? this.config.tsconfigPath;
    if (!configPath) return false;
    const state = _initProgram(configPath);
    if (!state) return false;
    this.programState = state;
    return true;
  }

  /** Detect exported symbols that are not imported by any other file. */
  detectUnusedExports(): UnusedExport[] {
    if (!this.programState) return [];
    return _detectUnusedExports(this.programState, this.config);
  }

  /** Detect import cycles. */
  detectImportCycles(): ImportCycle[] {
    if (!this.programState) return [];
    return _detectImportCycles(this.programState);
  }

  /** Detect contract drift. */
  detectContractDrift(contractDirs?: string[]): ContractDrift[] {
    if (!this.programState) return [];
    return _detectContractDrift(this.programState, contractDirs);
  }

  /** Run full program analysis. */
  analyzeProgram(tsconfigPath?: string): ProgramAnalysisResult {
    const configPath = tsconfigPath ?? this.config.tsconfigPath;
    if (!configPath) {
      return { unusedExports: [], importCycles: [], contractDrifts: [], fileCount: 0, duration: 0 };
    }
    return _analyzeProgram(configPath, this.config);
  }

  /** Aggregate metrics across all results. */
  getAggregateMetrics(results: ASTAnalysisResult[]): AggregateMetrics {
    if (results.length === 0) {
      return { totalFiles: 0, avgComplexity: 0, maxComplexity: 0, totalAssertions: 0, totalEffectiveLines: 0 };
    }
    const totalFiles = results.length;
    const totalAssertions = results.reduce((s, r) => s + r.metrics.typeAssertionCount, 0);
    const totalEffectiveLines = results.reduce((s, r) => s + r.metrics.effectiveLines, 0);
    const allAvgs = results.filter(r => r.metrics.avgCyclomaticComplexity > 0).map(r => r.metrics.avgCyclomaticComplexity);
    const avgComplexity = allAvgs.length > 0 ? allAvgs.reduce((a, b) => a + b, 0) / allAvgs.length : 0;
    const maxComplexity = Math.max(0, ...results.map(r => r.metrics.maxCyclomaticComplexity));
    return { totalFiles, avgComplexity: Math.round(avgComplexity * 100) / 100, maxComplexity, totalAssertions, totalEffectiveLines };
  }
}
