/**
 * Language Registry — dynamic spec loader.
 *
 * Scans languages/{lang}/spec.mjs at import time, validates each spec,
 * and provides lookup by file extension or language id.
 *
 * Adding a new language = creating languages/{lang}/spec.mjs with the
 * required shape. No quorum code changes needed.
 */

import { readdirSync, statSync } from "node:fs";
import { resolve, extname, dirname } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Required fields in spec.mjs (core metadata only) ────────

const REQUIRED_FIELDS = ["id", "name", "extensions"];

function validateSpec(spec, source) {
  for (const field of REQUIRED_FIELDS) {
    if (spec[field] == null) {
      throw new Error(`Language spec ${source} missing required field: ${field}`);
    }
  }
  if (!Array.isArray(spec.extensions) || spec.extensions.length === 0) {
    throw new Error(`Language spec ${source}: extensions must be a non-empty array`);
  }
  return true;
}

// ── Registry ────────────────────────────────────────────────

class LanguageRegistry {
  constructor() {
    /** @type {Map<string, object>} ext → spec */
    this._byExt = new Map();
    /** @type {Map<string, object>} id → spec */
    this._byId = new Map();
  }

  /**
   * Register a validated language spec.
   * @param {object} spec - must satisfy REQUIRED_FIELDS
   */
  register(spec) {
    this._byId.set(spec.id, spec);
    for (const ext of spec.extensions) {
      this._byExt.set(ext, spec);
    }
  }

  /** Look up spec by file path (uses extension). */
  forFile(filePath) {
    const ext = extname(filePath).toLowerCase();
    return this._byExt.get(ext) ?? null;
  }

  /** Look up spec by language id. */
  forId(id) {
    return this._byId.get(id) ?? null;
  }

  /** All registered language ids. */
  ids() {
    return [...this._byId.keys()];
  }

  /** Union of all registered extensions — replaces hardcoded CODE_EXT. */
  allExtensions() {
    return new Set(this._byExt.keys());
  }

  /**
   * Extensions for a specific quality domain.
   * Returns extensions of languages that have rules for that domain.
   * e.g., extensionsForDomain("a11y") → Set([".tsx", ".jsx"])
   */
  extensionsForDomain(domain) {
    const exts = new Set();
    for (const spec of this._byId.values()) {
      if (spec.qualityRules?.[domain]?.length > 0) {
        for (const ext of spec.extensions) exts.add(ext);
      }
    }
    return exts;
  }

  /**
   * Get quality patterns for a domain across all languages,
   * keyed by extension set for proper routing.
   * @returns {{ extensions: Set<string>, patterns: Array }[]}
   */
  patternsForDomain(domain) {
    const result = [];
    for (const spec of this._byId.values()) {
      const patterns = spec.qualityRules?.[domain];
      if (patterns?.length > 0) {
        result.push({
          langId: spec.id,
          extensions: new Set(spec.extensions),
          patterns,
        });
      }
    }
    return result;
  }

  /**
   * Detect which registered languages are present in a directory.
   * Quick check: does any file with a registered extension exist?
   * (Does NOT do full walkDir — just top-level + src/ sampling.)
   */
  detectLanguages(dir) {
    const found = new Set();
    const sampledDirs = [dir];
    // Sample common project directory conventions
    const candidates = ["src", "lib", "cli", "core", "bus", "app", "pkg", "cmd", "internal", "daemon", "providers", "server", "client", "engine"];
    for (const name of candidates) {
      const p = resolve(dir, name);
      if (existsSync(p) && statSync(p).isDirectory()) sampledDirs.push(p);
    }

    for (const d of sampledDirs) {
      try {
        for (const entry of readdirSync(d)) {
          const ext = extname(entry).toLowerCase();
          const spec = this._byExt.get(ext);
          if (spec) found.add(spec);
        }
      } catch (err) { console.warn("[lang-registry] detectLanguages readdir failed:", err?.message ?? err); }
    }
    return [...found];
  }

  /** Number of registered languages. */
  get size() { return this._byId.size; }
}

// ── Dynamic loading from languages/{lang}/spec.mjs ──────────

export const registry = new LanguageRegistry();

const LANGUAGES_DIR = __dirname;
let _loaded = false;

/**
 * Known fragment file patterns and where they merge into the spec.
 *
 * Convention: spec.{fragment}.mjs exports default array or object.
 *   spec.symbols.mjs    → spec.symbols      (array)
 *   spec.imports.mjs     → spec.imports      (object)
 *   spec.perf.mjs        → spec.qualityRules.perf     (array)
 *   spec.security.mjs    → spec.qualityRules.security  (array)
 *   spec.observability.mjs → spec.qualityRules.observability (array)
 *   spec.compat.mjs      → spec.qualityRules.compat   (array)
 *   spec.a11y.mjs        → spec.qualityRules.a11y     (array)
 *   spec.doc.mjs         → spec.docPatterns  (object)
 *
 * All fragments are optional. spec.mjs can still contain everything
 * inline — fragments only override/supplement if present.
 */
const QUALITY_DOMAINS = ["perf", "security", "observability", "compat", "a11y"];

async function tryImportDefault(filePath) {
  try {
    statSync(filePath);
    const mod = await import(pathToFileURL(filePath).href);
    return mod.default ?? mod.spec ?? null;
  } catch (err) {
    // ENOENT is expected for missing optional fragments — only warn on unexpected errors
    if (err?.code !== "ENOENT") {
      console.warn("[lang-registry] tryImportDefault failed:", err?.message ?? err);
    }
    return null;
  }
}

/**
 * Core-only fields allowed in spec.mjs. Everything else must be a fragment.
 */
const CORE_FIELDS = new Set([
  "id", "name", "extensions", "endBlock", "commentPrefixes",
  "jsxExtensions", "i18nHardcodedRe", "verify",
]);

/**
 * Load a single language directory: spec.mjs (core) + spec.*.mjs (fragments).
 *
 * spec.mjs MUST contain only core metadata (CORE_FIELDS).
 * Domain data (symbols, imports, qualityRules, docPatterns) MUST be in fragments.
 * Inline domain data in spec.mjs is stripped with a warning.
 */
async function loadLanguageDir(langDir, dirName) {
  const specPath = resolve(langDir, "spec.mjs");
  const coreMod = await tryImportDefault(specPath);
  if (!coreMod) return null;

  // Strip non-core fields from spec.mjs — fragments are the single source of truth
  const spec = {};
  for (const [key, value] of Object.entries(coreMod)) {
    if (CORE_FIELDS.has(key)) {
      spec[key] = value;
    } else if (process.env.QUORUM_DEBUG) {
      console.error(`[lang-registry] ${dirName}/spec.mjs: "${key}" ignored — move to spec.${key}.mjs fragment`);
    }
  }
  validateSpec(spec, `${dirName}/spec.mjs`);

  // ── Load fragments (single source of truth) ────────────────

  // spec.symbols.mjs → spec.symbols
  const symbols = await tryImportDefault(resolve(langDir, "spec.symbols.mjs"));
  if (symbols) spec.symbols = symbols;
  if (!spec.symbols) spec.symbols = [];

  // spec.imports.mjs → spec.imports
  const imports = await tryImportDefault(resolve(langDir, "spec.imports.mjs"));
  if (imports) spec.imports = imports;

  // spec.doc.mjs → spec.docPatterns
  const doc = await tryImportDefault(resolve(langDir, "spec.doc.mjs"));
  if (doc) spec.docPatterns = doc;

  // spec.{domain}.mjs → spec.qualityRules.{domain}
  spec.qualityRules = {};
  for (const domain of QUALITY_DOMAINS) {
    const rules = await tryImportDefault(resolve(langDir, `spec.${domain}.mjs`));
    if (rules) spec.qualityRules[domain] = rules;
  }

  return spec;
}

/**
 * Scan languages/ subdirectories and load spec.mjs + fragments from each.
 * Idempotent — only runs once.
 */
export async function loadAll() {
  if (_loaded) return registry;
  _loaded = true;

  let entries;
  try {
    entries = readdirSync(LANGUAGES_DIR, { withFileTypes: true });
  } catch (err) {
    console.warn("[lang-registry] loadAll readdir failed:", err?.message ?? err);
    return registry;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const langDir = resolve(LANGUAGES_DIR, entry.name);

    try {
      const spec = await loadLanguageDir(langDir, entry.name);
      if (!spec) continue;
      registry.register(spec);
    } catch (err) {
      if (process.env.QUORUM_DEBUG) {
        console.error(`[lang-registry] Failed to load ${entry.name}: ${err.message}`);
      }
      // fail-open: skip broken specs, continue loading others
    }
  }

  return registry;
}

// ── findEndLine strategies ──────────────────────────────────

/** Brace-based end detection (JS, TS, Go, Rust, Java, C#). */
export function findEndLineBrace(lines, startIdx) {
  let depth = 0, started = false;
  for (let i = startIdx; i < lines.length; i++) {
    for (const ch of lines[i]) {
      if (ch === "{") { depth++; started = true; }
      if (ch === "}") depth--;
    }
    if (started && depth <= 0) return i + 1;
  }
  return startIdx + 1;
}

/** Indent-based end detection (Python). */
export function findEndLineIndent(lines, startIdx) {
  if (startIdx >= lines.length) return startIdx + 1;
  const firstLine = lines[startIdx];
  // measure indent of the definition line
  const baseIndent = firstLine.match(/^(\s*)/)?.[1]?.length ?? 0;

  for (let i = startIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "") continue; // skip blank lines
    const indent = line.match(/^(\s*)/)?.[1]?.length ?? 0;
    if (indent <= baseIndent) return i; // back to same or lower indent = end
  }
  return lines.length; // reached EOF
}

/** Keyword-based end detection (Ruby, Elixir, Lua). */
export function findEndLineKeyword(lines, startIdx, endRe = /^\s*end\b/) {
  let depth = 1;
  const startRe = /\b(?:def|class|module|do|if|unless|case|begin)\b/;
  for (let i = startIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (startRe.test(line) && !line.trim().startsWith("#")) depth++;
    if (endRe.test(line)) depth--;
    if (depth <= 0) return i + 1;
  }
  return startIdx + 1;
}

/** Resolve endLine finder from spec.endBlock value. */
export function getEndLineFinder(spec) {
  const eb = spec.endBlock ?? "brace";
  if (eb === "brace") return findEndLineBrace;
  if (eb === "indent") return findEndLineIndent;
  if (eb === "end-keyword") return findEndLineKeyword;
  if (typeof eb === "function") return eb;
  return findEndLineBrace; // fallback
}
