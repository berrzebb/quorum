/**
 * tool-utils.mjs — Shared utility functions for MCP tools.
 *
 * Extracted from tool-core.mjs to reduce monolith size and enable reuse.
 * All functions are side-effect-free: params → result.
 *
 * Consumers should import from here directly, or via tool-core.mjs
 * which re-exports everything for backward compatibility.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, relative, extname } from "node:path";

// ═══ AST bridge — fail-safe optional import for hybrid scanning ════════
let _createAstRefine = null;
try {
  const astBridge = await import("./ast-bridge.mjs");
  _createAstRefine = astBridge.createAstRefineCallback;
} catch (err) { console.warn("[tool-utils] AST bridge unavailable:", err?.message ?? err); }

export { _createAstRefine };

// ═══ Language registry — fail-safe dynamic spec loading ════════════════
let _langRegistry = null;
let _getEndLineFinder = null;
try {
  const langMod = await import("../languages/registry.mjs");
  await langMod.loadAll();
  _langRegistry = langMod.registry;
  _getEndLineFinder = langMod.getEndLineFinder;
} catch (err) { console.warn("[tool-utils] language registry unavailable:", err?.message ?? err); }

export { _langRegistry, _getEndLineFinder };

/**
 * Gather quality patterns for a domain across all registered languages.
 * Falls back to legacy patterns when registry unavailable.
 */
export function _gatherDomainPatterns(domain, legacyPatterns) {
  if (!_langRegistry) return legacyPatterns;
  const groups = _langRegistry.patternsForDomain(domain);
  if (groups.length === 0) return legacyPatterns;
  // Flatten all language patterns into a single array.
  // runPatternScan filters by extension anyway, so mixing is safe.
  const all = [];
  for (const g of groups) all.push(...g.patterns);
  return all;
}

// ═══ Path Traversal Guard ═══════════════════════════════════════════════
//
// All MCP tool inputs that accept file paths MUST pass through safePath().
// Prevents directory traversal attacks (e.g. "../../../etc/passwd").
// Allowed: paths within cwd, absolute paths within cwd, relative paths that resolve within cwd.

export const _cwd = process.cwd();

/**
 * Validate and resolve a user-supplied path, preventing traversal attacks.
 * Returns the resolved absolute path, or throws if traversal detected.
 *
 * Rules:
 * - Relative paths must resolve within cwd (no ../../../etc/passwd)
 * - Absolute paths are allowed if they exist (tools need to scan tmpdir in tests)
 * - Paths containing ".." that escape cwd are blocked
 *
 * @param {string} userPath — raw path from MCP tool input
 * @param {string} [base] — base directory (default: process.cwd())
 * @returns {string} safe absolute path
 */
export function safePath(userPath, base) {
  if (!userPath || typeof userPath !== "string") return base || _cwd;
  const root = base || _cwd;
  const resolved = resolve(root, userPath);
  const normalizedRoot = resolve(root);

  // Block relative traversal outside project root
  if (userPath.includes("..") && !resolved.startsWith(normalizedRoot)) {
    throw new Error(`Path traversal blocked: "${userPath}" escapes project root via ".."`);
  }
  return resolved;
}

/**
 * Wrapper that returns error object instead of throwing (for tool functions).
 * @param {string} userPath
 * @param {string} [base]
 * @returns {{ path: string } | { error: string }}
 */
export function safePathOrError(userPath, base) {
  try {
    return { path: safePath(userPath, base) };
  } catch (e) {
    return { error: e.message };
  }
}

// ═══ Cache ══════════════════════════════════════════════════════════════

export const CACHE = new Map();

export function getCacheKey(path, filter, depth) {
  return `${path}|${filter || "all"}|${depth || 5}`;
}

export function getLatestMtime(target) {
  const stat = statSync(target, { throwIfNoEntry: false });
  if (!stat) return 0;
  if (!stat.isDirectory()) return stat.mtimeMs;

  let latest = 0;
  try {
    for (const e of readdirSync(target, { withFileTypes: true })) {
      if (e.name.startsWith(".") || e.name === "node_modules") continue;
      const full = resolve(target, e.name);
      const t = e.isDirectory() ? getLatestMtime(full) : statSync(full).mtimeMs;
      if (t > latest) latest = t;
    }
  } catch (err) { console.warn("[tool-utils] getLatestMtime failed:", err?.message ?? err); }
  return latest;
}

// ═══ code-map engine ════════════════════════════════════════════════════

/** Fallback extension set when language registry is unavailable. */
export const _LEGACY_CODE_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".mts"]);

/** All registered language extensions, or legacy fallback. */
export const CODE_EXT = _langRegistry?.allExtensions() ?? _LEGACY_CODE_EXT;

/** Legacy fallback patterns (JS/TS only). Used when registry unavailable. */
export const _LEGACY_PATTERNS = [
  { type: "fn", re: /^(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)/m },
  { type: "fn", re: /^(?:export\s+)?(?:const|let)\s+(\w+)\s*=\s*(?:async\s+)?\(([^)]*)\)\s*(?:=>|:\s*\w)/m },
  { type: "fn", re: /^(?:export\s+)?(?:const|let)\s+(\w+)\s*=\s*(?:async\s+)?function/m },
  { type: "method", re: /^\s+(?:async\s+)?(\w+)\s*\(([^)]*)\)\s*[:{]/m },
  { type: "class", re: /^(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/m },
  { type: "iface", re: /^(?:export\s+)?interface\s+(\w+)/m },
  { type: "type", re: /^(?:export\s+)?type\s+(\w+)\s*[=<]/m },
  { type: "enum", re: /^(?:export\s+)?enum\s+(\w+)/m },
  { type: "import", re: /^import\s+(?:type\s+)?(?:\{([^}]+)\}|(\w+))\s+from\s+["']([^"']+)["']/m },
];

/** Exported for backward compatibility. Resolves to language-aware patterns. */
export const PATTERNS = _LEGACY_PATTERNS;

/** Legacy brace-based end-line finder. Kept as default fallback. */
export function findEndLine(lines, startIdx) {
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

/**
 * Parse a source file for symbols using language-aware patterns.
 *
 * Resolution order:
 * 1. Language registry spec for this file's extension (dynamic, multi-language)
 * 2. Legacy JS/TS patterns (fallback)
 */
export function parseFile(filePath, filters) {
  let content;
  try { content = readFileSync(filePath, "utf8"); } catch (err) {
    if (process.env.QUORUM_DEBUG) console.error(`[tool-utils] parseFile: cannot read ${filePath}: ${err.message}`);
    return [];
  }

  // Resolve language spec — registry first, legacy fallback
  const spec = _langRegistry?.forFile(filePath);
  const patterns = spec?.symbols ?? _LEGACY_PATTERNS;
  const commentPrefixes = spec?.commentPrefixes ?? ["//", "/*", "*"];
  const endLineFn = (spec && _getEndLineFinder)
    ? _getEndLineFinder(spec)
    : findEndLine;

  const lines = content.split(/\r?\n/);
  const symbols = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trimStart();
    if (!trimmed) continue;
    // Skip comment lines
    if (commentPrefixes.some(p => trimmed.startsWith(p))) continue;

    for (const { type, re } of patterns) {
      if (filters && !filters.has(type)) continue;
      const m = line.match(re);
      if (!m) continue;

      let name, detail = "";
      if (type === "import") {
        name = (m[1] || m[2] || "").trim();
        if (name.length > 40) name = name.slice(0, 37) + "...";
        if (m[3]) detail = ` from "${m[3]}"`;
      } else {
        name = m[1] || "";
        if (m[2] !== undefined) {
          const p = m[2];
          detail = `(${p.length > 50 ? p.slice(0, 47) + "..." : p})`;
        }
      }

      const lineNum = i + 1;
      const endLine = endLineFn(lines, i);
      symbols.push({ line: lineNum, endLine, type, name, detail });
      break;
    }
  }
  return symbols;
}

// ═══ Directory walking ═════════════════════════════════════════════════

// Optional vendor: globby for .gitignore-aware glob (fail-safe)
let _globby = null;
try {
  const mod = await import("globby");
  _globby = mod.globby;
} catch { /* fallback to manual walkDir */ }

export function walkDir(dir, extensions, maxDepth, depth = 0) {
  if (depth > maxDepth) return [];
  const files = [];
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch (err) {
    if (process.env.QUORUM_DEBUG) console.error(`[tool-utils] walkDir: cannot read ${dir}: ${err.message}`);
    return [];
  }
  for (const e of entries) {
    if (e.name.startsWith(".") || e.name === "node_modules" || e.name === "dist") continue;
    const full = resolve(dir, e.name);
    if (e.isDirectory()) files.push(...walkDir(full, extensions, maxDepth, depth + 1));
    else if (extensions.has(extname(e.name))) files.push(full);
  }
  return files;
}

/**
 * Enhanced walkDir using globby — respects .gitignore, supports negation.
 * Falls back to manual walkDir if globby unavailable.
 *
 * @param {string} dir — root directory
 * @param {Set<string>} extensions — e.g. new Set([".ts", ".mjs"])
 * @param {number} maxDepth
 * @returns {Promise<string[]>}
 */
export async function walkDirAsync(dir, extensions, maxDepth) {
  if (_globby) {
    const extArray = [...extensions].map(e => `**/*${e}`);
    try {
      const results = await _globby(extArray, {
        cwd: dir,
        gitignore: true,
        onlyFiles: true,
        deep: maxDepth,
        absolute: true,
      });
      return results;
    } catch (err) {
      if (process.env.QUORUM_DEBUG) console.error(`[tool-utils] globby fallback: ${err.message}`);
    }
  }
  // Fallback to synchronous manual walk
  return walkDir(dir, extensions, maxDepth);
}

// ═══ Pattern scan helper ═══════════════════════════════════════════════
// Shared by perf_scan, a11y_scan, compat_check, license_scan, i18n_validate,
// infra_scan, observability_check. Eliminates ~400 lines of boilerplate.

/**
 * Generic pattern-scan tool runner.
 * @param {object} opts
 * @param {string} opts.targetPath - path param from tool input
 * @param {Set<string>} opts.extensions - file extensions to scan
 * @param {Array<{re: RegExp, label: string, severity: string, msg: string}>} opts.patterns
 * @param {string} opts.toolName - e.g. "perf_scan"
 * @param {string} opts.heading - e.g. "Performance Scan Results"
 * @param {string} opts.passMsg - e.g. "no performance anti-patterns detected"
 * @param {string} opts.failNoun - e.g. "high-severity issue(s)"
 * @param {number} [opts.maxDepth=5]
 * @param {(findings: any[], files: string[], cwd: string) => void} [opts.postProcess] - optional extra processing
 */
export function runPatternScan(opts) {
  const { targetPath, extensions, patterns, toolName, heading, passMsg, failNoun, maxDepth = 5, postProcess, astRefine } = opts;
  const cwd = process.cwd();
  // Path traversal guard — block inputs that escape project root
  const pathCheck = safePathOrError(targetPath, cwd);
  if (pathCheck.error) return { error: pathCheck.error };
  const target = pathCheck.path;
  const stat_ = statSync(target, { throwIfNoEntry: false });
  if (!stat_) return { error: `Not found: ${target}` };

  const files = stat_.isDirectory() ? walkDir(target, extensions, maxDepth) : [target];
  const findings = [];

  const SCAN_IGNORE_RE = /\/[/*]\s*scan-ignore\b/;

  for (const file of files) {
    let content;
    try { content = readFileSync(file, "utf8"); } catch (err) { console.warn("[tool-utils] runPatternScan file read failed:", err?.message ?? err); continue; }
    const lines = content.split(/\r?\n/);
    const relPath = relative(cwd, file).replace(/\\/g, "/");

    for (let i = 0; i < lines.length; i++) {
      if (SCAN_IGNORE_RE.test(lines[i])) continue;
      for (const pat of patterns) {
        if (pat.re.test(lines[i])) {
          findings.push({
            file: relPath,
            line: i + 1,
            severity: pat.severity,
            label: pat.label,
            msg: pat.msg,
          });
        }
      }
    }
  }

  if (postProcess) postProcess(findings, files, cwd);

  // AST refinement: remove false positives detected by AST analysis
  if (astRefine && findings.length > 0) {
    try { astRefine(findings); } catch (err) { console.warn("[tool-utils] astRefine failed:", err?.message ?? err); }
  }

  if (findings.length === 0) {
    return { text: `${toolName}: pass — ${passMsg}.`, summary: `${files.length} files scanned, 0 findings` };
  }

  const rows = [`## ${heading}\n`, "| File | Line | Severity | Issue |", "|------|------|----------|-------|"];
  for (const f of findings) rows.push(`| ${f.file} | ${f.line} | ${f.severity} | ${f.msg} |`);

  const highCount = findings.filter(f => f.severity === "high").length;
  const verdict = highCount > 0 ? `fail — ${highCount} ${failNoun}` : `warn — ${findings.length} finding(s)`;
  rows.push(`\n**Verdict**: ${verdict}`);

  return {
    text: rows.join("\n"),
    summary: `${files.length} files, ${findings.length} findings (${highCount} high)`,
    json: { total: findings.length, high: highCount, findings },
  };
}
