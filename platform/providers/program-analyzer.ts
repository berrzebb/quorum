/**
 * Program Analyzer — cross-file AST analysis using ts.createProgram.
 *
 * Extracted from ast-analyzer.ts (SPLIT-2).
 * Full type checker mode for unused export detection, import cycle detection,
 * and contract drift analysis.
 *
 * @module providers/program-analyzer
 */

import * as ts from "typescript";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import type {
  UnusedExport,
  ImportCycle,
  ContractDrift,
  ProgramAnalysisResult,
  ASTAnalyzerConfig,
} from "./ast-analyzer.js";
import { hasExportModifier } from "./source-file-analyzer.js";

// ── Program State ───────────────────────────────────

/** Managed program state for cross-file analysis. */
export interface ProgramState {
  program: ts.Program;
  checker: ts.TypeChecker;
}

// ── Program Initialization ──────────────────────────

/**
 * Initialize ts.createProgram from a tsconfig.json.
 * Required before calling cross-file analysis functions.
 */
export function initProgram(tsconfigPath: string): ProgramState | null {
  try {
    const resolvedPath = resolve(tsconfigPath);
    if (!existsSync(resolvedPath)) return null;
    const configFile = ts.readConfigFile(resolvedPath, (p) => readFileSync(p, "utf8"));
    if (configFile.error) return null;
    const parsed = ts.parseJsonConfigFileContent(
      configFile.config,
      ts.sys,
      dirname(resolvedPath),
    );
    const program = ts.createProgram(parsed.fileNames, parsed.options);
    return { program, checker: program.getTypeChecker() };
  } catch (err) {
    console.warn(`[program-analyzer] initProgram failed: ${(err as Error).message}`);
    return null;
  }
}

// ── Unused Exports ──────────────────────────────────

/**
 * Detect exported symbols that are not imported by any other file.
 */
export function detectUnusedExports(state: ProgramState, config: ASTAnalyzerConfig): UnusedExport[] {
  const { program } = state;

  // 1. Collect all imports across the program
  const importedSymbols = new Map<string, Set<string>>();
  const sourceFiles = program.getSourceFiles().filter(
    (sf) => !sf.isDeclarationFile && !sf.fileName.includes("node_modules"),
  );

  for (const sf of sourceFiles) {
    ts.forEachChild(sf, (node) => {
      if (ts.isImportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        const resolved = resolveModulePath(sf.fileName, node.moduleSpecifier.text, program);
        if (!resolved) return;

        const names = importedSymbols.get(resolved) ?? new Set();
        const clause = node.importClause;
        if (clause) {
          if (clause.name) names.add("default");
          if (clause.namedBindings) {
            if (ts.isNamedImports(clause.namedBindings)) {
              for (const spec of clause.namedBindings.elements) {
                names.add((spec.propertyName ?? spec.name).text);
              }
            } else if (ts.isNamespaceImport(clause.namedBindings)) {
              names.add("*");
            }
          }
        }
        importedSymbols.set(resolved, names);
      }

      if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        const resolved = resolveModulePath(sf.fileName, node.moduleSpecifier.text, program);
        if (!resolved) return;
        const names = importedSymbols.get(resolved) ?? new Set();
        if (node.exportClause && ts.isNamedExports(node.exportClause)) {
          for (const spec of node.exportClause.elements) {
            names.add((spec.propertyName ?? spec.name).text);
          }
        } else {
          names.add("*");
        }
        importedSymbols.set(resolved, names);
      }
    });
  }

  // 2. Find exports that are never imported
  const unused: UnusedExport[] = [];
  const maxFiles = config.maxFiles ?? 50;
  let filesProcessed = 0;

  for (const sf of sourceFiles) {
    if (filesProcessed >= maxFiles) break;
    filesProcessed++;

    const normalizedPath = sf.fileName.replace(/\\/g, "/");
    const importedNames = importedSymbols.get(normalizedPath);
    if (importedNames?.has("*")) continue;

    ts.forEachChild(sf, (node) => {
      if (!hasExportModifier(node)) return;
      const exportName = getExportedName(node);
      if (!exportName) return;
      if (importedNames?.has(exportName)) return;
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

// ── Import Cycles ───────────────────────────────────

/**
 * Detect import cycles using DFS on the import graph.
 */
export function detectImportCycles(state: ProgramState): ImportCycle[] {
  const { program } = state;

  const sourceFiles = program.getSourceFiles().filter(
    (sf) => !sf.isDeclarationFile && !sf.fileName.includes("node_modules"),
  );

  // Build adjacency list
  const graph = new Map<string, Set<string>>();
  for (const sf of sourceFiles) {
    const normalized = sf.fileName.replace(/\\/g, "/");
    const deps = graph.get(normalized) ?? new Set<string>();

    ts.forEachChild(sf, (node) => {
      if (ts.isImportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        const resolved = resolveModulePath(sf.fileName, node.moduleSpecifier.text, program);
        if (resolved) deps.add(resolved);
      }
      if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        const resolved = resolveModulePath(sf.fileName, node.moduleSpecifier.text, program);
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
      const cycleStart = stack.indexOf(node);
      if (cycleStart >= 0) {
        const cycle = stack.slice(cycleStart).concat(node);
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
      for (const dep of neighbors) { dfs(dep); }
    }

    stack.pop();
    inStack.delete(node);
  }

  for (const file of graph.keys()) {
    if (!visited.has(file)) dfs(file);
  }

  return cycles;
}

// ── Contract Drift ──────────────────────────────────

/**
 * Detect contract drift between type/interface declarations.
 */
export function detectContractDrift(
  state: ProgramState,
  contractDirs?: string[],
): ContractDrift[] {
  const { program, checker } = state;
  const drifts: ContractDrift[] = [];
  const contractPatterns = contractDirs ?? ["/types/", "/contracts/", "/interfaces/"];

  const sourceFiles = program.getSourceFiles().filter(
    (sf) => !sf.isDeclarationFile && !sf.fileName.includes("node_modules"),
  );

  const isContractFile = (fileName: string): boolean => {
    const normalized = fileName.replace(/\\/g, "/");
    return contractPatterns.some(p => normalized.includes(p));
  };

  // Phase 1: Collect contract symbols
  const contractSymbols = new Map<string, { file: string; node: ts.Node; symbol: ts.Symbol; line: number }>();

  for (const sf of sourceFiles) {
    if (!isContractFile(sf.fileName)) continue;
    const normalized = sf.fileName.replace(/\\/g, "/");

    ts.forEachChild(sf, (node) => {
      if (!hasExportModifier(node)) return;
      if (!ts.isInterfaceDeclaration(node) && !ts.isTypeAliasDeclaration(node)) return;

      const name = node.name.text;
      const symbol = checker.getSymbolAtLocation(node.name);
      if (!symbol) return;

      const { line } = sf.getLineAndCharacterOfPosition(node.getStart());
      contractSymbols.set(name, { file: normalized, node, symbol, line: line + 1 });
    });
  }

  if (contractSymbols.size === 0) return drifts;

  // Phase 2: Scan non-contract files
  for (const sf of sourceFiles) {
    const normalized = sf.fileName.replace(/\\/g, "/");
    if (isContractFile(normalized)) continue;
    if (normalized.endsWith("/index.ts") || normalized.endsWith("/index.tsx")) continue;

    ts.forEachChild(sf, (node) => {
      // Re-declaration detection
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

      // Implementation mismatch
      if (ts.isClassDeclaration(node) && node.heritageClauses) {
        for (const clause of node.heritageClauses) {
          if (clause.token !== ts.SyntaxKind.ImplementsKeyword) continue;
          for (const expr of clause.types) {
            const implName = expr.expression.getText(sf);
            const contract = contractSymbols.get(implName);
            if (!contract || !ts.isInterfaceDeclaration(contract.node)) continue;
            compareMembers(
              contract.node as ts.InterfaceDeclaration,
              contract.file,
              node,
              normalized,
              sf,
              checker,
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
 * Run full program analysis.
 */
export function analyzeProgram(
  tsconfigPath: string,
  config: ASTAnalyzerConfig,
): ProgramAnalysisResult {
  const start = Date.now();
  const state = initProgram(tsconfigPath);
  if (!state) {
    return { unusedExports: [], importCycles: [], contractDrifts: [], fileCount: 0, duration: Date.now() - start };
  }
  const sourceFiles = state.program.getSourceFiles().filter(
    (sf) => !sf.isDeclarationFile && !sf.fileName.includes("node_modules"),
  );
  return {
    unusedExports: detectUnusedExports(state, config),
    importCycles: detectImportCycles(state),
    contractDrifts: detectContractDrift(state),
    fileCount: sourceFiles.length,
    duration: Date.now() - start,
  };
}

// ── Helpers ─────────────────────────────────────────

function compareMembers(
  iface: ts.InterfaceDeclaration,
  contractFile: string,
  impl: ts.ClassDeclaration,
  implFile: string,
  sf: ts.SourceFile,
  checker: ts.TypeChecker,
  drifts: ContractDrift[],
): void {
  const contractName = iface.name.text;

  const contractMembers = new Map<string, string>();
  for (const member of iface.members) {
    if (!ts.isMethodSignature(member) && !ts.isPropertySignature(member)) continue;
    const name = member.name && ts.isIdentifier(member.name) ? member.name.text : null;
    if (!name) continue;
    const memberType = checker.getTypeAtLocation(member);
    contractMembers.set(name, checker.typeToString(memberType));
  }

  const implMembers = new Map<string, { type: string; line: number }>();
  for (const member of impl.members) {
    if (!ts.isMethodDeclaration(member) && !ts.isPropertyDeclaration(member)) continue;
    const name = member.name && ts.isIdentifier(member.name) ? member.name.text : null;
    if (!name) continue;
    const memberType = checker.getTypeAtLocation(member);
    const { line } = sf.getLineAndCharacterOfPosition(member.getStart());
    implMembers.set(name, { type: checker.typeToString(memberType), line: line + 1 });
  }

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

function resolveModulePath(fromFile: string, specifier: string, program: ts.Program): string | null {
  if (!specifier.startsWith(".") && !specifier.startsWith("/")) return null;
  try {
    const resolved = ts.resolveModuleName(specifier, fromFile, program.getCompilerOptions(), ts.sys);
    if (resolved.resolvedModule) {
      return resolved.resolvedModule.resolvedFileName.replace(/\\/g, "/");
    }
  } catch { /* ignore */ }
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
  const path = cycle.slice(0, -1);
  const minIdx = path.reduce((mi, s, i) => s < path[mi] ? i : mi, 0);
  const rotated = [...path.slice(minIdx), ...path.slice(0, minIdx)];
  return rotated.join(" → ");
}
