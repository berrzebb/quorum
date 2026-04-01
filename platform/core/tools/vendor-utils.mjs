/**
 * vendor-utils.mjs — Thin wrappers around validated vendor packages.
 *
 * Packages adopted from Claude Code's proven dependency set:
 * - globby: enhanced glob with .gitignore support
 * - marked: markdown → structured token parsing
 * - diff-match-patch: precise text diff for compact/handoff
 * - web-tree-sitter: WASM-based multi-language AST (no native build)
 *
 * All exports are fail-safe: returns null/fallback if vendor unavailable.
 *
 * @module core/tools/vendor-utils
 */

// ── Globby (enhanced glob) ─────────────────────────────

let _globby = null;
try {
  const mod = await import("globby");
  _globby = mod.globby;
} catch { /* optional */ }

/**
 * Enhanced glob with .gitignore support and negation patterns.
 * Falls back to null if globby unavailable.
 *
 * @param {string[]} patterns — glob patterns (supports negation with !)
 * @param {object} [options] — { cwd, gitignore, deep, onlyFiles }
 * @returns {Promise<string[]|null>}
 */
export async function enhancedGlob(patterns, options = {}) {
  if (!_globby) return null;
  return _globby(patterns, {
    gitignore: true,
    onlyFiles: true,
    ...options,
  });
}

/** @returns {boolean} */
export function isGlobbyAvailable() { return _globby !== null; }

// ── Marked (markdown parsing) ──────────────────────────

let _marked = null;
try {
  const mod = await import("marked");
  _marked = mod.marked;
} catch { /* optional */ }

/**
 * Parse markdown into structured tokens.
 * Useful for PRD/WB/design document parsing.
 *
 * @param {string} markdown
 * @returns {object[]|null} — marked token array or null
 */
export function parseMarkdownTokens(markdown) {
  if (!_marked) return null;
  return _marked.lexer(markdown);
}

/**
 * Extract all headings from markdown with depth.
 *
 * @param {string} markdown
 * @returns {{ depth: number, text: string, raw: string }[]|null}
 */
export function extractHeadings(markdown) {
  const tokens = parseMarkdownTokens(markdown);
  if (!tokens) return null;
  return tokens
    .filter(t => t.type === "heading")
    .map(t => ({ depth: t.depth, text: t.text, raw: t.raw }));
}

/**
 * Extract all code blocks with optional language filter.
 *
 * @param {string} markdown
 * @param {string} [lang] — filter by language (e.g. "typescript", "mermaid")
 * @returns {{ lang: string, text: string }[]|null}
 */
export function extractCodeBlocks(markdown, lang) {
  const tokens = parseMarkdownTokens(markdown);
  if (!tokens) return null;
  return tokens
    .filter(t => t.type === "code" && (!lang || t.lang === lang))
    .map(t => ({ lang: t.lang || "", text: t.text }));
}

/** @returns {boolean} */
export function isMarkedAvailable() { return _marked !== null; }

// ── Diff-Match-Patch (text diff) ───────────────────────

let _DiffMatchPatch = null;
try {
  const mod = await import("diff-match-patch");
  _DiffMatchPatch = mod.default || mod.diff_match_patch || mod;
} catch { /* optional */ }

/**
 * Compute line-level diff between two texts.
 * Returns array of [operation, text] pairs.
 * Operation: -1 = delete, 0 = equal, 1 = insert
 *
 * @param {string} text1 — old text
 * @param {string} text2 — new text
 * @returns {{ op: number, text: string }[]|null}
 */
export function computeDiff(text1, text2) {
  if (!_DiffMatchPatch) return null;
  const dmp = new _DiffMatchPatch();
  const diffs = dmp.diff_main(text1, text2);
  dmp.diff_cleanupSemantic(diffs);
  return diffs.map(([op, text]) => ({ op, text }));
}

/**
 * Generate a compact summary of what changed between two texts.
 * Returns { additions, deletions, changes } counts.
 *
 * @param {string} text1
 * @param {string} text2
 * @returns {{ additions: number, deletions: number, unchanged: number }|null}
 */
export function diffStats(text1, text2) {
  const diffs = computeDiff(text1, text2);
  if (!diffs) return null;
  let additions = 0, deletions = 0, unchanged = 0;
  for (const { op, text } of diffs) {
    const lines = text.split("\n").length - 1 || 1;
    if (op === 1) additions += lines;
    else if (op === -1) deletions += lines;
    else unchanged += lines;
  }
  return { additions, deletions, unchanged };
}

/**
 * Create a human-readable patch string.
 *
 * @param {string} text1
 * @param {string} text2
 * @returns {string|null}
 */
export function createPatch(text1, text2) {
  if (!_DiffMatchPatch) return null;
  const dmp = new _DiffMatchPatch();
  const patches = dmp.patch_make(text1, text2);
  return dmp.patch_toText(patches);
}

/** @returns {boolean} */
export function isDiffAvailable() { return _DiffMatchPatch !== null; }

// ── Web Tree-Sitter (multi-language AST) ───────────────

let _TreeSitter = null;
let _tsInitialized = false;

/**
 * Initialize web-tree-sitter WASM runtime.
 * Must be called before using parseWithTreeSitter.
 * Safe to call multiple times (idempotent).
 *
 * @returns {Promise<boolean>} — true if initialized successfully
 */
export async function initTreeSitter() {
  if (_tsInitialized) return _TreeSitter !== null;
  _tsInitialized = true;
  try {
    const mod = await import("web-tree-sitter");
    const Parser = mod.default || mod;
    await Parser.init();
    _TreeSitter = Parser;
    return true;
  } catch {
    return false;
  }
}

/**
 * Parse source code with tree-sitter for a given language.
 *
 * @param {string} source — source code text
 * @param {string} languageWasm — path to .wasm grammar file
 * @returns {Promise<object|null>} — tree-sitter Tree or null
 */
export async function parseWithTreeSitter(source, languageWasm) {
  if (!_TreeSitter) return null;
  try {
    const lang = await _TreeSitter.Language.load(languageWasm);
    const parser = new _TreeSitter();
    parser.setLanguage(lang);
    const tree = parser.parse(source);
    return tree;
  } catch {
    return null;
  }
}

/**
 * Extract named nodes (functions, classes, etc.) from a tree-sitter tree.
 *
 * @param {object} tree — tree-sitter Tree
 * @param {string[]} nodeTypes — e.g. ["function_declaration", "class_declaration"]
 * @returns {{ type: string, name: string, startLine: number, endLine: number }[]}
 */
export function extractNamedNodes(tree, nodeTypes) {
  if (!tree?.rootNode) return [];
  const results = [];
  const typeSet = new Set(nodeTypes);

  function walk(node) {
    if (typeSet.has(node.type)) {
      // Try to find the name — varies by language/node type
      const nameNode = node.childForFieldName("name")
        || node.children?.find(c => c.type === "identifier" || c.type === "property_identifier");
      results.push({
        type: node.type,
        name: nameNode?.text || "(anonymous)",
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
      });
    }
    for (let i = 0; i < node.childCount; i++) {
      walk(node.child(i));
    }
  }

  walk(tree.rootNode);
  return results;
}

/** @returns {boolean} */
export function isTreeSitterAvailable() { return _TreeSitter !== null; }

// ── Availability summary ───────────────────────────────

/**
 * Get availability status of all vendor packages.
 * @returns {{ globby: boolean, marked: boolean, diff: boolean, treeSitter: boolean }}
 */
export function vendorStatus() {
  return {
    globby: isGlobbyAvailable(),
    marked: isMarkedAvailable(),
    diff: isDiffAvailable(),
    treeSitter: isTreeSitterAvailable(),
  };
}
