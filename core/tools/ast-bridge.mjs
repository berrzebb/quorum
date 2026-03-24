/**
 * ast-bridge.mjs — Fail-safe bridge from MJS tool layer to compiled AST analyzer.
 *
 * Eagerly loads dist/providers/ast-analyzer.js via top-level await.
 * If unavailable (not compiled, missing dep), _analyzer stays null (fail-open).
 *
 * All exported functions are synchronous — safe to use from runPatternScan.
 */

import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { existsSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST = resolve(__dirname, "..", "..", "dist");
const AST_PATH = resolve(DIST, "providers", "ast-analyzer.js");

let _analyzer = null;
let _loadError = null;

// Top-level await: load once at import time, fail silently
try {
  if (existsSync(AST_PATH)) {
    const mod = await import(pathToFileURL(AST_PATH).href);
    _analyzer = new mod.ASTAnalyzer();
  }
} catch (err) {
  _loadError = err;
  /* fail-open: AST unavailable */
}

/** Check if AST analyzer is available (for diagnostics/testing). */
export function isAstAvailable() { return _analyzer !== null; }
export function getAstLoadError() { return _loadError; }

/**
 * Create a synchronous astRefine callback for runPatternScan.
 *
 * Converts regex findings → RegexCandidates, runs AST refinement,
 * then mutates the findings array: overridden findings get removed.
 *
 * @param {string} cwd - Working directory (for resolving relative paths)
 * @returns {Function|null} Callback or null if AST unavailable
 */
export function createAstRefineCallback(cwd) {
  if (!_analyzer) return null;

  return function astRefine(findings) {
    const candidates = findings.map(f => ({
      file: resolve(cwd, f.file),
      line: f.line,
      column: f.column,
      regexLabel: f.label,
      regexSeverity: f.severity,
    }));

    if (candidates.length === 0) return;

    let astFindings;
    try {
      astFindings = _analyzer.refineCandidates(candidates);
    } catch {
      return; // fail-open: keep regex findings as-is
    }

    if (astFindings.length === 0) return;

    // Build override set: file:line keys that AST says are false positives
    const overrides = new Set();
    for (const af of astFindings) {
      if (af.overridesRegex) {
        overrides.add(`${af.file}:${af.line}`);
      }
    }

    // Remove overridden regex findings (mutate in-place, reverse order)
    for (let i = findings.length - 1; i >= 0; i--) {
      const absPath = resolve(cwd, findings[i].file);
      if (overrides.has(`${absPath}:${findings[i].line}`)) {
        findings.splice(i, 1);
      }
    }
  };
}

/**
 * Run full AST analysis on files. Used by fitness score engine (Phase 3).
 * @param {string[]} filePaths - Absolute file paths
 * @returns {object[]|null} Analysis results or null if AST unavailable
 */
export function analyzeFiles(filePaths) {
  if (!_analyzer) return null;
  try {
    return _analyzer.analyzeFiles(filePaths);
  } catch {
    return null;
  }
}

/**
 * Get aggregate metrics across analysis results.
 * @param {object[]} results - From analyzeFiles()
 * @returns {object|null}
 */
export function getAggregateMetrics(results) {
  if (!_analyzer) return null;
  try {
    return _analyzer.getAggregateMetrics(results);
  } catch {
    return null;
  }
}
