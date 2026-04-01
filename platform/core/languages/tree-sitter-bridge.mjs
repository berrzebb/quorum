/**
 * Tree-Sitter Bridge — multi-language AST via WASM.
 *
 * Connects web-tree-sitter to quorum's 5-language registry.
 * Provides language-agnostic AST operations:
 * - Symbol extraction (functions, classes, interfaces, types)
 * - Import/export analysis
 * - Complexity estimation
 *
 * Unlike the TypeScript Compiler API (ast-analyzer.ts), this covers
 * all 5 quorum languages: TypeScript, Python, Go, Rust, Java.
 *
 * Fail-safe: returns null/empty if WASM init fails.
 *
 * @module core/languages/tree-sitter-bridge
 */

import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── State ──────────────────────────────────────────────

let Parser = null;
let _initialized = false;
/** @type {Map<string, object>} langId → Language instance */
const _languages = new Map();

// ── Grammar mapping ────────────────────────────────────

/**
 * Maps quorum language IDs to grammar resolution info.
 * Each entry has: npm package name + wasm filename.
 */
const GRAMMAR_MAP = {
  typescript: { pkg: "tree-sitter-typescript", wasm: "tree-sitter-typescript.wasm" },
  python:     { pkg: "tree-sitter-python",     wasm: "tree-sitter-python.wasm" },
  go:         { pkg: "tree-sitter-go",         wasm: "tree-sitter-go.wasm" },
  rust:       { pkg: "tree-sitter-rust",        wasm: "tree-sitter-rust.wasm" },
  java:       { pkg: "tree-sitter-java",        wasm: "tree-sitter-java.wasm" },
};

/**
 * Node types that represent "symbols" per language.
 * Used by extractSymbols() for language-agnostic symbol extraction.
 */
const SYMBOL_NODE_TYPES = {
  typescript: [
    "function_declaration", "arrow_function", "method_definition",
    "class_declaration", "interface_declaration", "type_alias_declaration",
    "enum_declaration", "variable_declarator",
  ],
  python: [
    "function_definition", "class_definition",
    "decorated_definition",
  ],
  go: [
    "function_declaration", "method_declaration",
    "type_declaration", "type_spec",
  ],
  rust: [
    "function_item", "impl_item", "struct_item",
    "enum_item", "trait_item", "type_item",
  ],
  java: [
    "method_declaration", "class_declaration",
    "interface_declaration", "enum_declaration",
    "constructor_declaration",
  ],
};

/**
 * Node types that represent imports per language.
 */
const IMPORT_NODE_TYPES = {
  typescript: ["import_statement", "import_clause"],
  python: ["import_statement", "import_from_statement"],
  go: ["import_declaration", "import_spec"],
  rust: ["use_declaration"],
  java: ["import_declaration"],
};

// ── Init ───────────────────────────────────────────────

function resolveGrammarPath(grammarInfo) {
  const { pkg, wasm } = grammarInfo;

  // Try npm package first (e.g. node_modules/tree-sitter-typescript/tree-sitter-typescript.wasm)
  const pkgPath = resolve(process.cwd(), "node_modules", pkg, wasm);
  if (existsSync(pkgPath)) return pkgPath;

  // Try tree-sitter-wasms bundle (older approach)
  const wasmsPath = resolve(process.cwd(), "node_modules", "tree-sitter-wasms", "out", wasm);
  if (existsSync(wasmsPath)) return wasmsPath;

  // Try local grammars directory
  const localPath = resolve(__dirname, "grammars", wasm);
  if (existsSync(localPath)) return localPath;

  return null;
}

/**
 * Initialize web-tree-sitter and load grammars for specified languages.
 * Safe to call multiple times (idempotent).
 *
 * @param {string[]} [langIds] — language IDs to load (default: all 5)
 * @returns {Promise<{ loaded: string[], failed: string[] }>}
 */
export async function initTreeSitterBridge(langIds) {
  const targets = langIds || Object.keys(GRAMMAR_MAP);
  const loaded = [];
  const failed = [];

  if (!_initialized) {
    _initialized = true;
    try {
      const mod = await import("web-tree-sitter");
      Parser = mod.default || mod;
      // locateFile tells the WASM loader where to find the runtime .wasm
      const runtimeDir = resolve(process.cwd(), "node_modules", "web-tree-sitter");
      await Parser.init({
        locateFile: (file) => resolve(runtimeDir, file),
      });
    } catch (err) {
      if (process.env.QUORUM_DEBUG) console.warn("[tree-sitter-bridge] WASM init failed:", err?.message);
      return { loaded, failed: targets };
    }
  }

  if (!Parser) return { loaded, failed: targets };

  for (const langId of targets) {
    if (_languages.has(langId)) {
      loaded.push(langId);
      continue;
    }

    const grammarInfo = GRAMMAR_MAP[langId];
    if (!grammarInfo) {
      failed.push(langId);
      continue;
    }

    const grammarPath = resolveGrammarPath(grammarInfo);
    if (!grammarPath) {
      if (process.env.QUORUM_DEBUG) console.warn(`[tree-sitter-bridge] grammar not found: ${grammarInfo.wasm}`);
      failed.push(langId);
      continue;
    }

    try {
      const lang = await Parser.Language.load(grammarPath);
      _languages.set(langId, lang);
      loaded.push(langId);
    } catch (err) {
      if (process.env.QUORUM_DEBUG) console.warn(`[tree-sitter-bridge] load ${langId} failed:`, err?.message);
      failed.push(langId);
    }
  }

  return { loaded, failed };
}

// ── Parse ──────────────────────────────────────────────

/**
 * Parse source code and return the tree-sitter tree.
 *
 * @param {string} source — source code
 * @param {string} langId — quorum language ID
 * @returns {object|null} — tree-sitter Tree or null
 */
export function parse(source, langId) {
  const lang = _languages.get(langId);
  if (!Parser || !lang) return null;

  const parser = new Parser();
  parser.setLanguage(lang);
  return parser.parse(source);
}

// ── Symbol Extraction ──────────────────────────────────

/**
 * @typedef {Object} ASTSymbol
 * @property {string} type — node type (language-specific)
 * @property {string} name — symbol name
 * @property {number} startLine — 1-indexed
 * @property {number} endLine — 1-indexed
 * @property {string} kind — normalized kind: "function" | "class" | "type" | "method" | "import" | "other"
 */

/**
 * Extract symbols (functions, classes, types, etc.) from source code.
 * Language-agnostic — works for all 5 quorum languages.
 *
 * @param {string} source
 * @param {string} langId
 * @returns {ASTSymbol[]}
 */
export function extractSymbols(source, langId) {
  const tree = parse(source, langId);
  if (!tree) return [];

  const nodeTypes = SYMBOL_NODE_TYPES[langId] || [];
  const typeSet = new Set(nodeTypes);
  const symbols = [];

  function walk(node) {
    if (typeSet.has(node.type)) {
      const nameNode = node.childForFieldName("name")
        || node.children?.find(c =>
          c.type === "identifier"
          || c.type === "property_identifier"
          || c.type === "type_identifier"
        );

      symbols.push({
        type: node.type,
        name: nameNode?.text || "(anonymous)",
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
        kind: classifyNodeKind(node.type),
      });
    }
    for (let i = 0; i < node.childCount; i++) {
      walk(node.child(i));
    }
  }

  walk(tree.rootNode);
  return symbols;
}

/**
 * Classify a tree-sitter node type into a normalized kind.
 */
function classifyNodeKind(nodeType) {
  if (/function|arrow_function/.test(nodeType)) return "function";
  if (/method/.test(nodeType)) return "method";
  if (/class/.test(nodeType)) return "class";
  if (/interface|trait/.test(nodeType)) return "interface";
  if (/type_alias|type_spec|type_item|type_declaration/.test(nodeType)) return "type";
  if (/enum/.test(nodeType)) return "enum";
  if (/struct/.test(nodeType)) return "struct";
  if (/impl/.test(nodeType)) return "impl";
  if (/import|use_declaration/.test(nodeType)) return "import";
  return "other";
}

// ── Import Analysis ────────────────────────────────────

/**
 * @typedef {Object} ImportInfo
 * @property {string} source — import path/module
 * @property {number} line — 1-indexed
 * @property {string} raw — raw import text
 */

/**
 * Extract import statements from source code.
 *
 * @param {string} source
 * @param {string} langId
 * @returns {ImportInfo[]}
 */
export function extractImports(source, langId) {
  const tree = parse(source, langId);
  if (!tree) return [];

  const nodeTypes = IMPORT_NODE_TYPES[langId] || [];
  const typeSet = new Set(nodeTypes);
  const imports = [];

  function walk(node) {
    if (typeSet.has(node.type)) {
      // Extract source/module path
      const sourceNode = node.childForFieldName("source")
        || node.childForFieldName("path")
        || node.children?.find(c => c.type === "string" || c.type === "interpreted_string_literal");

      imports.push({
        source: sourceNode?.text?.replace(/["']/g, "") || node.text.slice(0, 80),
        line: node.startPosition.row + 1,
        raw: node.text.length > 120 ? node.text.slice(0, 117) + "..." : node.text,
      });
    }
    for (let i = 0; i < node.childCount; i++) {
      walk(node.child(i));
    }
  }

  walk(tree.rootNode);
  return imports;
}

// ── Complexity ─────────────────────────────────────────

/**
 * Estimate cyclomatic complexity by counting branch nodes.
 *
 * @param {string} source
 * @param {string} langId
 * @returns {{ total: number, perFunction: { name: string, complexity: number }[] }|null}
 */
export function estimateComplexity(source, langId) {
  const tree = parse(source, langId);
  if (!tree) return null;

  const BRANCH_TYPES = new Set([
    "if_statement", "if_expression",
    "for_statement", "for_expression", "for_in_statement",
    "while_statement", "while_expression",
    "switch_statement", "match_expression", "match_arm",
    "case_clause", "catch_clause",
    "conditional_expression", "ternary_expression",
    "binary_expression", // && and || count as branches
    "try_statement",
  ]);

  let total = 1; // Base complexity

  function walk(node) {
    if (BRANCH_TYPES.has(node.type)) {
      // For binary expressions, only count && and ||
      if (node.type === "binary_expression") {
        const op = node.childForFieldName("operator")?.text;
        if (op === "&&" || op === "||") total++;
      } else {
        total++;
      }
    }
    for (let i = 0; i < node.childCount; i++) {
      walk(node.child(i));
    }
  }

  walk(tree.rootNode);

  // Per-function breakdown
  const symbols = extractSymbols(source, langId)
    .filter(s => s.kind === "function" || s.kind === "method");

  // Simple estimation: total / functions (uniform distribution)
  const avgPerFn = symbols.length > 0 ? Math.round(total / symbols.length) : total;
  const perFunction = symbols.map(s => ({
    name: s.name,
    complexity: avgPerFn, // Simplified — full per-function needs scope tracking
  }));

  return { total, perFunction };
}

// ── Status ─────────────────────────────────────────────

/**
 * Get loaded language status.
 * @returns {{ initialized: boolean, languages: string[] }}
 */
export function bridgeStatus() {
  return {
    initialized: Parser !== null,
    languages: [..._languages.keys()],
  };
}

/**
 * Check if a language is loaded.
 * @param {string} langId
 * @returns {boolean}
 */
export function isLanguageLoaded(langId) {
  return _languages.has(langId);
}
