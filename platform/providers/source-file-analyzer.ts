/**
 * Source File Analyzer — single-file AST analysis (no type checker).
 *
 * Extracted from ast-analyzer.ts (SPLIT-1).
 * Fast mode: <50ms/file, no ts.createProgram needed.
 *
 * 5 analyzers: type assertions, while(true) safety, cyclomatic complexity,
 * export counting, regex candidate refinement.
 *
 * @module providers/source-file-analyzer
 */

import * as ts from "typescript";
import { readFileSync } from "node:fs";
import type {
  ASTFinding,
  FileMetrics,
  ASTAnalysisResult,
  RegexCandidate,
  ASTAnalyzerConfig,
} from "./ast-analyzer.js";

// ── Single-File Analysis ────────────────────────────

/**
 * Analyze files producing findings and metrics.
 * No ts.Program needed — uses ts.createSourceFile per file.
 */
export function analyzeFiles(
  filePaths: string[],
  config: ASTAnalyzerConfig,
): ASTAnalysisResult[] {
  const files = filePaths.slice(0, config.maxFiles ?? 50);
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
      console.warn(`[source-file-analyzer] parse failed for ${filePath}: ${(err as Error).message}`);
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

// ── Regex Candidate Refinement ──────────────────────

/**
 * Refine regex candidates with AST context.
 * Returns AST findings that override or confirm regex matches.
 */
export function refineCandidates(candidates: RegexCandidate[]): ASTFinding[] {
  const byFile = new Map<string, RegexCandidate[]>();
  for (const c of candidates) {
    const list = byFile.get(c.file) ?? [];
    list.push(c);
    byFile.set(c.file, list);
  }

  const results: ASTFinding[] = [];

  for (const [filePath, fileCandidates] of byFile) {
    let content: string;
    try { content = readFileSync(filePath, "utf8"); } catch { continue; }

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

// ── Helpers ─────────────────────────────────────────

export function isLiteralTrue(node: ts.Expression): boolean {
  return node.kind === ts.SyntaxKind.TrueKeyword;
}

export function containsExitStatement(node: ts.Node): boolean {
  let found = false;
  const visit = (n: ts.Node): void => {
    if (found) return;
    if (ts.isBreakStatement(n) || ts.isReturnStatement(n) || ts.isThrowStatement(n)) {
      found = true;
      return;
    }
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

export function computeCyclomaticComplexity(node: ts.Node): number {
  let complexity = 1;
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

export function hasExportModifier(node: ts.Node): boolean {
  if (!ts.canHaveModifiers(node)) return false;
  const mods = ts.getModifiers(node);
  return mods?.some(m => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;
}

export function countEffectiveLines(content: string): number {
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

export function findNodeAtPosition(sourceFile: ts.SourceFile, pos: number): ts.Node | null {
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

export function findEnclosingWhile(node: ts.Node): ts.WhileStatement | null {
  let current: ts.Node | undefined = node;
  while (current) {
    if (ts.isWhileStatement(current)) return current;
    current = current.parent;
  }
  return null;
}

export function isInsideNonCodeContext(sourceFile: ts.SourceFile, pos: number, content: string): boolean {
  const { line } = sourceFile.getLineAndCharacterOfPosition(pos);
  const lineStart = sourceFile.getPositionOfLineAndCharacter(line, 0);
  const lineEnd = line + 1 < sourceFile.getLineStarts().length
    ? sourceFile.getPositionOfLineAndCharacter(line + 1, 0)
    : content.length;
  const lineText = content.slice(lineStart, lineEnd);

  if (/\bre:\s*\//.test(lineText) && /label:\s*"/.test(lineText)) return true;
  if (/^\s*\/\//.test(lineText)) return true;

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
