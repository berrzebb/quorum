/**
 * AST Analyzer — TypeScript Compiler API wrapper for context-aware code analysis.
 *
 * Two modes:
 * - sourceFile: fast single-file parsing (<50ms/file), no type checking
 * - program: full ts.createProgram with type checker, for cross-file analysis
 *
 * Used as a precision layer on top of regex-based runPatternScan.
 */

import * as ts from "typescript";
import { readFileSync, existsSync } from "node:fs";
import { resolve, relative, dirname } from "node:path";

// ── Types ────────────────────────────────────────────

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
  /** Context that AST provided (beyond what regex could see). */
  astContext?: string;
  /** Whether this overrides/suppresses a regex finding. */
  overridesRegex?: boolean;
  /** The regex pattern label being refined, if any. */
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

// ── Program-mode types ────────────────────────────────

export interface UnusedExport {
  file: string;
  name: string;
  line: number;
  kind: "function" | "class" | "variable" | "type" | "interface" | "enum" | "other";
}

export interface ImportCycle {
  /** Files forming the cycle, in order (last imports first). */
  files: string[];
}

export interface ContractDrift {
  /** Contract file where the type is defined. */
  contractFile: string;
  /** Name of the contract type/interface. */
  contractName: string;
  /** Kind: 'redeclaration' | 'signature-mismatch' | 'missing-member' */
  kind: "redeclaration" | "signature-mismatch" | "missing-member";
  /** File where the violation occurs. */
  violationFile: string;
  violationLine: number;
  /** Details: e.g. "load() returns Promise<AssetId> but contract says Promise<AssetInfo>" */
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

// ── Analyzer ─────────────────────────────────────────

export class ASTAnalyzer {
  private config: ASTAnalyzerConfig;
  private program?: ts.Program;
  private checker?: ts.TypeChecker;

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
    const files = filePaths.slice(0, this.config.maxFiles ?? 50);
    const results: ASTAnalysisResult[] = [];

    for (const filePath of files) {
      const start = Date.now();
      try {
        const content = readFileSync(filePath, "utf8");
        const sourceFile = ts.createSourceFile(
          filePath,
          content,
          ts.ScriptTarget.Latest,
          true,
          filePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
        );

        const findings: ASTFinding[] = [];
        const complexities: number[] = [];
        let assertionCount = 0;
        let exportCount = 0;

        const visit = (node: ts.Node): void => {
          // 1. Type assertions (as any, as unknown, as SomeType)
          if (ts.isAsExpression(node)) {
            assertionCount++;
            const typeText = node.type.getText(sourceFile);
            if (typeText === "any" || typeText === "unknown") {
              const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
              findings.push({
                file: filePath,
                line: line + 1,
                column: character + 1,
                category: "unnecessary-assertion",
                severity: typeText === "any" ? "high" : "medium",
                message: `\`as ${typeText}\` — consider using a specific type or type guard`,
                astContext: `expression: ${node.expression.getText(sourceFile).slice(0, 60)}`,
              });
            }
          }

          // 2. Control flow: while(true) safety
          if (ts.isWhileStatement(node)) {
            if (isLiteralTrue(node.expression)) {
              const hasExit = containsExitStatement(node.statement);
              const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
              if (hasExit) {
                findings.push({
                  file: filePath,
                  line: line + 1,
                  column: character + 1,
                  category: "safe-loop",
                  severity: "low",
                  message: "while(true) with break/return — safe",
                  overridesRegex: true,
                  regexLabel: "busy-loop",
                });
              } else {
                findings.push({
                  file: filePath,
                  line: line + 1,
                  column: character + 1,
                  category: "unsafe-loop",
                  severity: "high",
                  message: "while(true) without break/return — potential busy loop",
                });
              }
            }
          }

          // 3. Cyclomatic complexity (per function/method)
          if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) ||
              ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
            const cc = computeCyclomaticComplexity(node);
            complexities.push(cc);
          }

          // 4. Export count
          if (hasExportModifier(node)) {
            exportCount++;
          }

          ts.forEachChild(node, visit);
        };

        ts.forEachChild(sourceFile, visit);

        // Compute effective lines (non-blank, non-comment)
        const effectiveLines = countEffectiveLines(content);

        const avgCC = complexities.length > 0
          ? complexities.reduce((a, b) => a + b, 0) / complexities.length
          : 0;
        const maxCC = complexities.length > 0 ? Math.max(...complexities) : 0;

        results.push({
          file: filePath,
          findings,
          metrics: {
            avgCyclomaticComplexity: Math.round(avgCC * 100) / 100,
            maxCyclomaticComplexity: maxCC,
            typeAssertionCount: assertionCount,
            effectiveLines,
            exportCount,
          },
          duration: Date.now() - start,
        });
      } catch (err) {
        // Fail-open: skip files that can't be parsed
        console.warn(`[ast-analyzer] file parse failed for ${filePath}: ${(err as Error).message}`);
        results.push({
          file: filePath,
          findings: [],
          metrics: { avgCyclomaticComplexity: 0, maxCyclomaticComplexity: 0, typeAssertionCount: 0, effectiveLines: 0, exportCount: 0 },
          duration: Date.now() - start,
        });
      }
    }
    return results;
  }

  /**
   * Refine regex candidates with AST context.
   * Returns AST findings that override or confirm regex matches.
   */
  refineCandidates(candidates: RegexCandidate[]): ASTFinding[] {
    // Group candidates by file
    const byFile = new Map<string, RegexCandidate[]>();
    for (const c of candidates) {
      const list = byFile.get(c.file) ?? [];
      list.push(c);
      byFile.set(c.file, list);
    }

    const results: ASTFinding[] = [];

    for (const [filePath, fileCandidates] of byFile) {
      let content: string;
      try { content = readFileSync(filePath, "utf8"); } catch (err) { console.warn(`[ast-analyzer] file read failed for ${filePath}: ${(err as Error).message}`); continue; }

      const sourceFile = ts.createSourceFile(
        filePath,
        content,
        ts.ScriptTarget.Latest,
        true,
        filePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
      );

      for (const candidate of fileCandidates) {
        const lineIdx = candidate.line - 1;
        let col = candidate.column ? candidate.column - 1 : 0;

        // If no column given, skip leading whitespace to land on actual code
        if (!candidate.column) {
          const lineStart = sourceFile.getPositionOfLineAndCharacter(lineIdx, 0);
          const nextLineStart = lineIdx + 1 < sourceFile.getLineStarts().length
            ? sourceFile.getPositionOfLineAndCharacter(lineIdx + 1, 0)
            : content.length;
          const lineText = content.slice(lineStart, nextLineStart);
          const indent = lineText.match(/^\s*/)?.[0].length ?? 0;
          col = indent;
        }

        const pos = sourceFile.getPositionOfLineAndCharacter(lineIdx, col);

        // Check non-code context first — comments have no AST node (TS treats them as trivia)
        if (isInsideNonCodeContext(sourceFile, pos, content)) {
          results.push({
            file: filePath,
            line: candidate.line,
            column: 1,
            category: "context-false-positive",
            severity: "low",
            message: `Regex match for "${candidate.regexLabel}" is inside a string/regex/comment — false positive`,
            overridesRegex: true,
            regexLabel: candidate.regexLabel,
          });
          continue;
        }

        // Label-specific refinement (needs AST node)
        const node = findNodeAtPosition(sourceFile, pos);
        if (!node) continue;

        if (candidate.regexLabel === "busy-loop") {
          const whileNode = findEnclosingWhile(node);
          if (whileNode && containsExitStatement(whileNode.statement)) {
            results.push({
              file: filePath,
              line: candidate.line,
              column: 1,
              category: "safe-loop",
              severity: "low",
              message: "while(true) has break/return — safe",
              overridesRegex: true,
              regexLabel: "busy-loop",
            });
          }
        }
      }
    }
    return results;
  }

  // ── Program mode: cross-file analysis ─────────────

  /**
   * Initialize ts.createProgram from a tsconfig.json.
   * Required before calling detectUnusedExports() or detectImportCycles().
   */
  initProgram(tsconfigPath?: string): boolean {
    const configPath = tsconfigPath ?? this.config.tsconfigPath;
    if (!configPath) return false;
    try {
      const resolved = resolve(configPath);
      if (!existsSync(resolved)) return false;
      const configFile = ts.readConfigFile(resolved, (p) => readFileSync(p, "utf8"));
      if (configFile.error) return false;
      const parsed = ts.parseJsonConfigFileContent(
        configFile.config,
        ts.sys,
        dirname(resolved),
      );
      this.program = ts.createProgram(parsed.fileNames, parsed.options);
      this.checker = this.program.getTypeChecker();
      return true;
    } catch (err) {
      console.warn(`[ast-analyzer] initProgram failed: ${(err as Error).message}`);
      return false;
    }
  }

  /**
   * Detect exported symbols that are not imported by any other file in the program.
   * Requires initProgram() to have been called.
   */
  detectUnusedExports(): UnusedExport[] {
    if (!this.program || !this.checker) return [];
    const start = Date.now();

    // 1. Collect all imports across the program
    const importedSymbols = new Map<string, Set<string>>(); // file → Set<name>
    const sourceFiles = this.program.getSourceFiles().filter(
      (sf) => !sf.isDeclarationFile && !sf.fileName.includes("node_modules"),
    );

    for (const sf of sourceFiles) {
      ts.forEachChild(sf, (node) => {
        if (ts.isImportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
          const resolved = resolveModulePath(sf.fileName, node.moduleSpecifier.text, this.program!);
          if (!resolved) return;

          const names = importedSymbols.get(resolved) ?? new Set();
          const clause = node.importClause;
          if (clause) {
            // default import
            if (clause.name) names.add("default");
            // named imports
            if (clause.namedBindings) {
              if (ts.isNamedImports(clause.namedBindings)) {
                for (const spec of clause.namedBindings.elements) {
                  names.add((spec.propertyName ?? spec.name).text);
                }
              } else if (ts.isNamespaceImport(clause.namedBindings)) {
                // import * as X — consider all exports used
                names.add("*");
              }
            }
          }
          importedSymbols.set(resolved, names);
        }

        // Also handle re-exports: export { X } from "./Y"
        if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
          const resolved = resolveModulePath(sf.fileName, node.moduleSpecifier.text, this.program!);
          if (!resolved) return;
          const names = importedSymbols.get(resolved) ?? new Set();
          if (node.exportClause && ts.isNamedExports(node.exportClause)) {
            for (const spec of node.exportClause.elements) {
              names.add((spec.propertyName ?? spec.name).text);
            }
          } else {
            // export * from — all exports used
            names.add("*");
          }
          importedSymbols.set(resolved, names);
        }
      });
    }

    // 2. Find exports that are never imported
    const unused: UnusedExport[] = [];
    const maxFiles = this.config.maxFiles ?? 50;
    let filesProcessed = 0;

    for (const sf of sourceFiles) {
      if (filesProcessed >= maxFiles) break;
      filesProcessed++;

      const normalizedPath = sf.fileName.replace(/\\/g, "/");
      const importedNames = importedSymbols.get(normalizedPath);
      // If any file does `import * as X` from this file, all exports are "used"
      if (importedNames?.has("*")) continue;

      ts.forEachChild(sf, (node) => {
        if (!hasExportModifier(node)) return;

        const exportName = getExportedName(node);
        if (!exportName) return;

        // Skip if imported somewhere
        if (importedNames?.has(exportName)) return;

        // Skip index/barrel files (they re-export, not originate)
        if (sf.fileName.endsWith("index.ts") || sf.fileName.endsWith("index.tsx")) return;

        const { line } = sf.getLineAndCharacterOfPosition(node.getStart());
        unused.push({
          file: normalizedPath,
          name: exportName,
          line: line + 1,
          kind: getExportKind(node),
        });
      });
    }

    return unused;
  }

  /**
   * Detect import cycles in the program.
   * Returns unique cycles (shortest path representation).
   */
  detectImportCycles(): ImportCycle[] {
    if (!this.program) return [];

    const sourceFiles = this.program.getSourceFiles().filter(
      (sf) => !sf.isDeclarationFile && !sf.fileName.includes("node_modules"),
    );

    // Build adjacency list
    const graph = new Map<string, Set<string>>();
    for (const sf of sourceFiles) {
      const normalized = sf.fileName.replace(/\\/g, "/");
      const deps = graph.get(normalized) ?? new Set<string>();

      ts.forEachChild(sf, (node) => {
        if (ts.isImportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
          const resolved = resolveModulePath(sf.fileName, node.moduleSpecifier.text, this.program!);
          if (resolved) deps.add(resolved);
        }
        if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
          const resolved = resolveModulePath(sf.fileName, node.moduleSpecifier.text, this.program!);
          if (resolved) deps.add(resolved);
        }
      });
      graph.set(normalized, deps);
    }

    // DFS cycle detection
    const cycles: ImportCycle[] = [];
    const visited = new Set<string>();
    const inStack = new Set<string>();
    const stack: string[] = [];
    const seenCycles = new Set<string>();

    function dfs(node: string): void {
      if (inStack.has(node)) {
        // Found a cycle — extract it
        const cycleStart = stack.indexOf(node);
        if (cycleStart >= 0) {
          const cycle = stack.slice(cycleStart).concat(node);
          // Normalize: rotate so smallest path comes first
          const key = normalizeCycleKey(cycle);
          if (!seenCycles.has(key)) {
            seenCycles.add(key);
            cycles.push({ files: cycle });
          }
        }
        return;
      }
      if (visited.has(node)) return;

      visited.add(node);
      inStack.add(node);
      stack.push(node);

      const neighbors = graph.get(node);
      if (neighbors) {
        for (const dep of neighbors) {
          dfs(dep);
        }
      }

      stack.pop();
      inStack.delete(node);
    }

    for (const file of graph.keys()) {
      if (!visited.has(file)) dfs(file);
    }

    return cycles;
  }

  /**
   * Detect contract drift: type/interface declarations in contract directories
   * vs their re-declarations or mismatched implementations elsewhere.
   *
   * Contract directories: paths containing /types/, /contracts/, /interfaces/
   * or explicitly provided via contractDirs option.
   *
   * Detects:
   * 1. Re-declaration — same interface/type name exported from non-contract file
   * 2. Signature mismatch — implementing class has different method signature
   * 3. Missing member — implementing class lacks a contract-required member
   */
  detectContractDrift(contractDirs?: string[]): ContractDrift[] {
    if (!this.program || !this.checker) return [];

    const drifts: ContractDrift[] = [];
    const contractPatterns = contractDirs ?? ["/types/", "/contracts/", "/interfaces/"];

    const sourceFiles = this.program.getSourceFiles().filter(
      (sf) => !sf.isDeclarationFile && !sf.fileName.includes("node_modules"),
    );

    const isContractFile = (fileName: string): boolean => {
      const normalized = fileName.replace(/\\/g, "/");
      return contractPatterns.some(p => normalized.includes(p));
    };

    // Phase 1: Collect all exported types/interfaces from contract files
    const contractSymbols = new Map<string, { file: string; node: ts.Node; symbol: ts.Symbol; line: number }>();

    for (const sf of sourceFiles) {
      if (!isContractFile(sf.fileName)) continue;
      const normalized = sf.fileName.replace(/\\/g, "/");

      ts.forEachChild(sf, (node) => {
        if (!hasExportModifier(node)) return;
        if (!ts.isInterfaceDeclaration(node) && !ts.isTypeAliasDeclaration(node)) return;

        const name = node.name.text;
        const symbol = this.checker!.getSymbolAtLocation(node.name);
        if (!symbol) return;

        const { line } = sf.getLineAndCharacterOfPosition(node.getStart());
        contractSymbols.set(name, { file: normalized, node, symbol, line: line + 1 });
      });
    }

    if (contractSymbols.size === 0) return drifts;

    // Phase 2: Scan non-contract files for re-declarations and implementation mismatches
    for (const sf of sourceFiles) {
      const normalized = sf.fileName.replace(/\\/g, "/");
      if (isContractFile(normalized)) continue;
      // Skip barrel/index files
      if (normalized.endsWith("/index.ts") || normalized.endsWith("/index.tsx")) continue;

      ts.forEachChild(sf, (node) => {
        // 2a. Re-declaration detection: same name exported from non-contract file
        if (hasExportModifier(node) && (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node))) {
          const name = node.name.text;
          const contract = contractSymbols.get(name);
          if (contract) {
            const { line } = sf.getLineAndCharacterOfPosition(node.getStart());
            drifts.push({
              contractFile: contract.file,
              contractName: name,
              kind: "redeclaration",
              violationFile: normalized,
              violationLine: line + 1,
              detail: `"${name}" re-declared in non-contract file. Single source must be ${contract.file}:${contract.line}`,
              severity: "critical",
            });
          }
        }

        // 2b. Implementation mismatch: class implements ContractInterface
        if (ts.isClassDeclaration(node) && node.heritageClauses) {
          for (const clause of node.heritageClauses) {
            if (clause.token !== ts.SyntaxKind.ImplementsKeyword) continue;

            for (const expr of clause.types) {
              const implName = expr.expression.getText(sf);
              const contract = contractSymbols.get(implName);
              if (!contract || !ts.isInterfaceDeclaration(contract.node)) continue;

              // Compare members
              this.compareMembers(
                contract.node as ts.InterfaceDeclaration,
                contract.file,
                node,
                normalized,
                sf,
                drifts,
              );
            }
          }
        }
      });
    }

    return drifts;
  }

  /**
   * Compare interface members against class implementation.
   */
  private compareMembers(
    iface: ts.InterfaceDeclaration,
    contractFile: string,
    impl: ts.ClassDeclaration,
    implFile: string,
    sf: ts.SourceFile,
    drifts: ContractDrift[],
  ): void {
    if (!this.checker) return;
    const contractName = iface.name.text;

    // Collect interface method/property signatures
    const contractMembers = new Map<string, string>();
    for (const member of iface.members) {
      if (!ts.isMethodSignature(member) && !ts.isPropertySignature(member)) continue;
      const name = member.name && ts.isIdentifier(member.name) ? member.name.text : null;
      if (!name) continue;

      const memberType = this.checker.getTypeAtLocation(member);
      contractMembers.set(name, this.checker.typeToString(memberType));
    }

    // Collect class members
    const implMembers = new Map<string, { type: string; line: number }>();
    for (const member of impl.members) {
      if (!ts.isMethodDeclaration(member) && !ts.isPropertyDeclaration(member)) continue;
      const name = member.name && ts.isIdentifier(member.name) ? member.name.text : null;
      if (!name) continue;

      const memberType = this.checker.getTypeAtLocation(member);
      const { line } = sf.getLineAndCharacterOfPosition(member.getStart());
      implMembers.set(name, { type: this.checker.typeToString(memberType), line: line + 1 });
    }

    // Check: missing members
    for (const [name, contractType] of contractMembers) {
      const implMember = implMembers.get(name);
      if (!implMember) {
        const { line } = sf.getLineAndCharacterOfPosition(impl.getStart());
        drifts.push({
          contractFile,
          contractName,
          kind: "missing-member",
          violationFile: implFile,
          violationLine: line + 1,
          detail: `"${name}" (${contractType}) required by ${contractName} but missing in implementation`,
          severity: "high",
        });
        continue;
      }

      // Check: signature mismatch
      if (implMember.type !== contractType) {
        drifts.push({
          contractFile,
          contractName,
          kind: "signature-mismatch",
          violationFile: implFile,
          violationLine: implMember.line,
          detail: `${name}(): contract says "${contractType}" but implementation has "${implMember.type}"`,
          severity: "critical",
        });
      }
    }
  }

  /**
   * Run full program analysis: unused exports + import cycles + contract drift.
   */
  analyzeProgram(tsconfigPath?: string): ProgramAnalysisResult {
    const start = Date.now();
    const initialized = this.initProgram(tsconfigPath);
    if (!initialized) {
      return { unusedExports: [], importCycles: [], contractDrifts: [], fileCount: 0, duration: Date.now() - start };
    }
    const sourceFiles = this.program!.getSourceFiles().filter(
      (sf) => !sf.isDeclarationFile && !sf.fileName.includes("node_modules"),
    );
    return {
      unusedExports: this.detectUnusedExports(),
      importCycles: this.detectImportCycles(),
      contractDrifts: this.detectContractDrift(),
      fileCount: sourceFiles.length,
      duration: Date.now() - start,
    };
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

// ── Helpers ──────────────────────────────────────────

function isLiteralTrue(node: ts.Expression): boolean {
  return node.kind === ts.SyntaxKind.TrueKeyword;
}

/** Check if a statement block contains break or return (any depth). */
function containsExitStatement(node: ts.Node): boolean {
  let found = false;
  const visit = (n: ts.Node): void => {
    if (found) return;
    if (ts.isBreakStatement(n) || ts.isReturnStatement(n) || ts.isThrowStatement(n)) {
      found = true;
      return;
    }
    // Don't descend into nested loops/functions (their breaks don't exit the outer while)
    if (ts.isWhileStatement(n) || ts.isForStatement(n) || ts.isForInStatement(n) ||
        ts.isForOfStatement(n) || ts.isDoStatement(n) ||
        ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n)) {
      return;
    }
    ts.forEachChild(n, visit);
  };
  ts.forEachChild(node, visit);
  return found;
}

/** Compute cyclomatic complexity of a function node. */
function computeCyclomaticComplexity(node: ts.Node): number {
  let complexity = 1; // base path
  const visit = (n: ts.Node): void => {
    switch (n.kind) {
      case ts.SyntaxKind.IfStatement:
      case ts.SyntaxKind.ConditionalExpression:
      case ts.SyntaxKind.WhileStatement:
      case ts.SyntaxKind.ForStatement:
      case ts.SyntaxKind.ForInStatement:
      case ts.SyntaxKind.ForOfStatement:
      case ts.SyntaxKind.DoStatement:
      case ts.SyntaxKind.CaseClause:
      case ts.SyntaxKind.CatchClause:
        complexity++;
        break;
      case ts.SyntaxKind.BinaryExpression: {
        const bin = n as ts.BinaryExpression;
        if (bin.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
            bin.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
            bin.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) {
          complexity++;
        }
        break;
      }
    }
    ts.forEachChild(n, visit);
  };
  ts.forEachChild(node, visit);
  return complexity;
}

function hasExportModifier(node: ts.Node): boolean {
  if (!ts.canHaveModifiers(node)) return false;
  const mods = ts.getModifiers(node);
  return mods?.some(m => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;
}

function countEffectiveLines(content: string): number {
  const lines = content.split(/\r?\n/);
  let count = 0;
  let inBlockComment = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (inBlockComment) {
      if (trimmed.includes("*/")) inBlockComment = false;
      continue;
    }
    if (trimmed.startsWith("/*")) {
      inBlockComment = !trimmed.includes("*/");
      continue;
    }
    if (trimmed && !trimmed.startsWith("//") && !trimmed.startsWith("*")) {
      count++;
    }
  }
  return count;
}

function findNodeAtPosition(sourceFile: ts.SourceFile, pos: number): ts.Node | null {
  let found: ts.Node | null = null;
  const visit = (node: ts.Node): void => {
    if (node.getStart() <= pos && pos < node.getEnd()) {
      found = node;
      ts.forEachChild(node, visit);
    }
  };
  ts.forEachChild(sourceFile, visit);
  return found;
}

function findEnclosingWhile(node: ts.Node): ts.WhileStatement | null {
  let current: ts.Node | undefined = node;
  while (current) {
    if (ts.isWhileStatement(current)) return current;
    current = current.parent;
  }
  return null;
}

// ── Program-mode helpers ─────────────────────────────

function resolveModulePath(fromFile: string, specifier: string, program: ts.Program): string | null {
  // Skip non-relative imports (npm packages etc.)
  if (!specifier.startsWith(".") && !specifier.startsWith("/")) return null;
  try {
    const resolved = ts.resolveModuleName(
      specifier,
      fromFile,
      program.getCompilerOptions(),
      ts.sys,
    );
    if (resolved.resolvedModule) {
      return resolved.resolvedModule.resolvedFileName.replace(/\\/g, "/");
    }
  } catch (err) { console.warn(`[ast-analyzer] module resolution failed for ${specifier}: ${(err as Error).message}`); }
  return null;
}

function getExportedName(node: ts.Node): string | null {
  if (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isEnumDeclaration(node)) {
    return node.name?.text ?? null;
  }
  if (ts.isVariableStatement(node)) {
    const decl = node.declarationList.declarations[0];
    if (decl && ts.isIdentifier(decl.name)) return decl.name.text;
  }
  if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) {
    return node.name.text;
  }
  return null;
}

function getExportKind(node: ts.Node): UnusedExport["kind"] {
  if (ts.isFunctionDeclaration(node)) return "function";
  if (ts.isClassDeclaration(node)) return "class";
  if (ts.isVariableStatement(node)) return "variable";
  if (ts.isInterfaceDeclaration(node)) return "interface";
  if (ts.isTypeAliasDeclaration(node)) return "type";
  if (ts.isEnumDeclaration(node)) return "enum";
  return "other";
}

function normalizeCycleKey(cycle: string[]): string {
  // Remove the last element (duplicate of first)
  const path = cycle.slice(0, -1);
  // Rotate so smallest string comes first
  const minIdx = path.reduce((mi, s, i) => s < path[mi] ? i : mi, 0);
  const rotated = [...path.slice(minIdx), ...path.slice(0, minIdx)];
  return rotated.join(" → ");
}

/** Check if a position falls inside a string literal, regex literal, or comment. */
function isInsideNonCodeContext(sourceFile: ts.SourceFile, pos: number, content: string): boolean {
  // Use the line text to check for regex/string literal context
  const { line } = sourceFile.getLineAndCharacterOfPosition(pos);
  const lineStart = sourceFile.getPositionOfLineAndCharacter(line, 0);
  const lineEnd = line + 1 < sourceFile.getLineStarts().length
    ? sourceFile.getPositionOfLineAndCharacter(line + 1, 0)
    : content.length;
  const lineText = content.slice(lineStart, lineEnd);

  // Quick heuristic: if the line is a pattern definition (contains `re: /`)
  // or a string assignment (contains `msg: "`) — it's likely non-code context
  if (/\bre:\s*\//.test(lineText) && /label:\s*"/.test(lineText)) return true;
  if (/^\s*\/\//.test(lineText)) return true; // full-line comment

  // Find the innermost node at position
  const node = findNodeAtPosition(sourceFile, pos);
  if (!node) return false;

  let current: ts.Node | undefined = node;
  while (current) {
    if (ts.isStringLiteral(current) || ts.isNoSubstitutionTemplateLiteral(current) ||
        ts.isTemplateExpression(current) || ts.isRegularExpressionLiteral(current)) {
      return true;
    }
    current = current.parent;
  }
  return false;
}
