/**
 * tool-core.mjs — Pure tool functions shared by MCP server and CLI runner.
 *
 * Extracted from mcp-server.mjs to enable both:
 *   - mcp-server.mjs (JSON-RPC over stdio)
 *   - tool-runner.mjs (CLI entry point for skills)
 *
 * All functions are side-effect-free: params → { text, summary, json? } | { error }.
 */
import { readFileSync, readdirSync, statSync, existsSync, mkdirSync, writeFileSync as _writeFileSync, copyFileSync, unlinkSync } from "node:fs";
import { readJsonlFile } from "../context.mjs";
import { resolve, relative, extname, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { runFvmValidation } from "./fvm-validator.mjs";
import { generateFvm } from "./fvm-generator.mjs";

// AST bridge — fail-safe optional import for hybrid scanning
let _createAstRefine = null;
try {
  const astBridge = await import("./ast-bridge.mjs");
  _createAstRefine = astBridge.createAstRefineCallback;
} catch { /* AST bridge unavailable — regex-only mode */ }

// Language registry — fail-safe dynamic spec loading
let _langRegistry = null;
let _getEndLineFinder = null;
try {
  const langMod = await import("../../../languages/registry.mjs");
  await langMod.loadAll();
  _langRegistry = langMod.registry;
  _getEndLineFinder = langMod.getEndLineFinder;
} catch { /* Language registry unavailable — legacy hardcoded mode */ }

/**
 * Gather quality patterns for a domain across all registered languages.
 * Falls back to legacy patterns when registry unavailable.
 */
function _gatherDomainPatterns(domain, legacyPatterns) {
  if (!_langRegistry) return legacyPatterns;
  const groups = _langRegistry.patternsForDomain(domain);
  if (groups.length === 0) return legacyPatterns;
  // Flatten all language patterns into a single array.
  // runPatternScan filters by extension anyway, so mixing is safe.
  const all = [];
  for (const g of groups) all.push(...g.patterns);
  return all;
}

const __dirname = dirname(fileURLToPath(import.meta.url));

// ═══ Path Traversal Guard ═══════════════════════════════════════════════
//
// All MCP tool inputs that accept file paths MUST pass through safePath().
// Prevents directory traversal attacks (e.g. "../../../etc/passwd").
// Allowed: paths within cwd, absolute paths within cwd, relative paths that resolve within cwd.

const _cwd = process.cwd();

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
function safePath(userPath, base) {
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
function safePathOrError(userPath, base) {
  try {
    return { path: safePath(userPath, base) };
  } catch (e) {
    return { error: e.message };
  }
}

// ═══ Cache ══════════════════════════════════════════════════════════════

const CACHE = new Map();

function getCacheKey(path, filter, depth) {
  return `${path}|${filter || "all"}|${depth || 5}`;
}

function getLatestMtime(target) {
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
  } catch { /* permission error */ }
  return latest;
}

// ═══ code-map engine ════════════════════════════════════════════════════

/** Fallback extension set when language registry is unavailable. */
const _LEGACY_CODE_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".mts"]);

/** All registered language extensions, or legacy fallback. */
const CODE_EXT = _langRegistry?.allExtensions() ?? _LEGACY_CODE_EXT;

/** Legacy fallback patterns (JS/TS only). Used when registry unavailable. */
const _LEGACY_PATTERNS = [
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
    if (process.env.QUORUM_DEBUG) console.error(`[tool-core] parseFile: cannot read ${filePath}: ${err.message}`);
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

export function walkDir(dir, extensions, maxDepth, depth = 0) {
  if (depth > maxDepth) return [];
  const files = [];
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch (err) {
    if (process.env.QUORUM_DEBUG) console.error(`[tool-core] walkDir: cannot read ${dir}: ${err.message}`);
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
    try { content = readFileSync(file, "utf8"); } catch { continue; }
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
    try { astRefine(findings); } catch { /* fail-open */ }
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

// ═══ Matrix formatter ═══════════════════════════════════════════════════

function formatMatrix(fileSymbols, cwd) {
  const rows = [];
  let prevFile = "";

  for (const { file, symbols } of fileSymbols) {
    const rel = relative(cwd, file).replace(/\\/g, "/");
    if (symbols.length === 0) continue;

    if (rel !== prevFile) {
      if (prevFile) rows.push("");
      rows.push(`## ${rel} (${symbols.length})`);
      prevFile = rel;
    }

    for (const s of symbols) {
      const loc = s.endLine > s.line
        ? `L${s.line}-${s.endLine}`.padEnd(12)
        : `L${s.line}`.padEnd(12);
      const type = s.type.padEnd(7);
      rows.push(`  ${loc}${type}${s.name}${s.detail}`);
    }
  }

  return rows.join("\n");
}

// ═══ Overview matrix (birds-eye table) ══════════════════════════════════

function formatOverviewMatrix(fileSymbols, cwd) {
  const rows = [];
  rows.push("| File | Lines | fn | method | class | iface | type | enum |");
  rows.push("|------|------:|---:|-------:|------:|------:|-----:|-----:|");

  for (const { file, symbols } of fileSymbols) {
    const rel = relative(cwd, file).replace(/\\/g, "/");
    let lineCount = 0;
    try {
      const buf = readFileSync(file);
      lineCount = 1;
      for (let i = 0; i < buf.length; i++) { if (buf[i] === 0x0A) lineCount++; }
    } catch { /* skip */ }

    const counts = { fn: 0, method: 0, class: 0, iface: 0, type: 0, enum: 0 };
    for (const s of symbols) {
      if (s.type in counts) counts[s.type]++;
    }
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    if (total === 0) continue;

    const cell = (n) => n > 0 ? String(n) : "·";
    rows.push(
      `| ${rel} | ${lineCount} | ${cell(counts.fn)} | ${cell(counts.method)} | ${cell(counts.class)} | ${cell(counts.iface)} | ${cell(counts.type)} | ${cell(counts.enum)} |`
    );
  }

  return rows.join("\n");
}

// ═══ Tool: code_map ═════════════════════════════════════════════════════

export function toolCodeMap(params) {
  const { path: targetPath, filter, depth = 5 } = params;
  if (!targetPath) return { error: "path is required" };

  const pathCheck = safePathOrError(targetPath);
  if (pathCheck.error) return pathCheck;
  const target = pathCheck.path;
  const stat = statSync(target, { throwIfNoEntry: false });
  if (!stat) return { error: `Not found: ${target}` };

  const cacheKey = getCacheKey(targetPath, filter, depth);
  const latestMtime = getLatestMtime(target);
  const cached = CACHE.get(cacheKey);
  if (cached && cached.mtime >= latestMtime) {
    return { ...cached.result, cached: true };
  }

  const extensions = params.extensions
    ? new Set(params.extensions.split(","))
    : CODE_EXT;
  const filters = filter ? new Set(filter.split(",")) : null;
  const files = stat.isDirectory()
    ? walkDir(target, extensions, depth)
    : [target];

  const cwd = process.cwd();
  const fileSymbols = [];
  let totalSymbols = 0;

  for (const file of files.sort()) {
    const symbols = parseFile(file, filters);
    fileSymbols.push({ file, symbols });
    totalSymbols += symbols.length;
  }

  const format = params.format || "detail";
  const text = format === "matrix"
    ? formatOverviewMatrix(fileSymbols, cwd)
    : formatMatrix(fileSymbols, cwd);
  const summary = `${files.length} files, ${totalSymbols} symbols`;
  const result = { text, summary };

  CACHE.set(cacheKey, { mtime: latestMtime, result });

  return result;
}

// ═══ Tool: audit_scan ═══════════════════════════════════════════════════

export function toolAuditScan(params) {
  const { pattern = "all", path: targetPath } = params;
  if (targetPath) { const c = safePathOrError(targetPath); if (c.error) return c; }
  const scriptPath = resolve(__dirname, "audit-scan.mjs");
  if (!existsSync(scriptPath)) return { error: "audit-scan.mjs not found" };

  try {
    const args = [scriptPath, pattern];
    if (targetPath) args.push(targetPath);
    const output = execFileSync(process.execPath, args, {
      cwd: process.cwd(),
      encoding: "utf8",
      timeout: 30000,
      windowsHide: true,
    });
    return { text: output.trim() };
  } catch (err) {
    return { error: err.message, stdout: err.stdout?.trim() };
  }
}

// ═══ Tool: coverage_map ═════════════════════════════════════════════════

function loadCoverageSummary(coverageDir) {
  const summaryPath = resolve(coverageDir, "coverage-summary.json");
  if (!existsSync(summaryPath)) return null;
  const raw = JSON.parse(readFileSync(summaryPath, "utf8"));
  const result = new Map();
  for (const [filePath, data] of Object.entries(raw)) {
    if (filePath === "total") continue;
    result.set(filePath.replace(/\\/g, "/"), {
      statements: data.statements?.pct ?? 0,
      branches: data.branches?.pct ?? 0,
      functions: data.functions?.pct ?? 0,
      lines: data.lines?.pct ?? 0,
    });
  }
  return result;
}

export function toolCoverageMap(params) {
  const { path: targetPath, coverage_dir: covDir = "coverage" } = params;
  if (targetPath) { const c = safePathOrError(targetPath); if (c.error) return c; }
  // Use targetPath as project root if it's a directory, else cwd
  let projectRoot = process.cwd();
  if (targetPath) {
    const p = resolve(targetPath);
    try { if (statSync(p).isDirectory()) projectRoot = p; } catch { /* use cwd */ }
  }
  const coverageMap = loadCoverageSummary(resolve(projectRoot, covDir));
  if (!coverageMap) return { error: `No coverage data at ${resolve(projectRoot, covDir, "coverage-summary.json")}. Run: npm run test:coverage` };

  const filter = targetPath ? targetPath.replace(/\\/g, "/") : null;
  const rows = [];
  rows.push("| File | Statements | Branches | Functions | Lines |");
  rows.push("|------|-----------|----------|-----------|-------|");

  let count = 0;
  for (const [filePath, data] of [...coverageMap.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const rel = relative(projectRoot, filePath).replace(/\\/g, "/");
    if (filter && !rel.includes(filter) && !filePath.includes(filter)) continue;
    rows.push(`| ${rel} | ${data.statements}% | ${data.branches}% | ${data.functions}% | ${data.lines}% |`);
    count++;
  }

  return { text: rows.join("\n"), summary: `${count} files` };
}

// ═══ Tool: dependency_graph ═════════════════════════════════════════════

/** Legacy JS/TS import patterns. */
const _LEGACY_IMPORT_PATTERNS = [
  /^import\s+(?:type\s+)?(?:\{[^}]*\}|\w+|\*\s+as\s+\w+)(?:\s*,\s*(?:\{[^}]*\}|\w+))?\s+from\s+["']([^"']+)["']/,
  /^export\s+(?:type\s+)?\{[^}]*\}\s+from\s+["']([^"']+)["']/,
  /(?:require|import)\s*\(\s*["']([^"']+)["']\s*\)/,
  /import\s*\(\s*["']([^"']+)["']\s*\)/,
];

// Re-export individual patterns for backward compatibility
const IMPORT_RE = _LEGACY_IMPORT_PATTERNS[0];
const EXPORT_FROM_RE = _LEGACY_IMPORT_PATTERNS[1];
const REQUIRE_RE = _LEGACY_IMPORT_PATTERNS[2];
const DYNAMIC_IMPORT_RE = _LEGACY_IMPORT_PATTERNS[3];

/**
 * Extract import specifiers from a source file.
 * Uses language-aware patterns when registry is available.
 */
function extractImports(filePath) {
  let content;
  try { content = readFileSync(filePath, "utf8"); } catch (err) {
    if (process.env.QUORUM_DEBUG) console.error(`[tool-core] extractImports: cannot read ${filePath}: ${err.message}`);
    return [];
  }

  const spec = _langRegistry?.forFile(filePath);
  const importPatterns = spec?.imports?.patterns ?? _LEGACY_IMPORT_PATTERNS;
  const commentPrefixes = spec?.commentPrefixes ?? ["//", "*"];

  const imports = [];
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (commentPrefixes.some(p => trimmed.startsWith(p))) continue;
    for (const re of importPatterns) {
      const m = trimmed.match(re);
      if (m && m[1]) {
        imports.push(m[1]);
        break;
      }
    }
  }
  return imports;
}

function resolveImportPath(fromFile, specifier, extensions) {
  if (specifier.startsWith(".")) {
    const base = resolve(dirname(fromFile), specifier);
    if (existsSync(base) && statSync(base).isFile()) return base;
    // TypeScript: import "./foo.js" → actual file is foo.ts
    const jsToSource = [
      [".js", ".ts"], [".js", ".tsx"],
      [".mjs", ".mts"], [".jsx", ".tsx"],
    ];
    for (const [from, to] of jsToSource) {
      if (base.endsWith(from)) {
        const swapped = base.slice(0, -from.length) + to;
        if (existsSync(swapped)) return swapped;
      }
    }
    for (const ext of extensions) {
      const withExt = base + ext;
      if (existsSync(withExt)) return withExt;
    }
    for (const ext of extensions) {
      const index = resolve(base, "index" + ext);
      if (existsSync(index)) return index;
    }
  }

  // Python-style dotted module imports: "engine.board" → engine/board.py
  if (/^[a-zA-Z_]\w*(\.\w+)*$/.test(specifier) && extensions.some(e => e === ".py")) {
    const parts = specifier.split(".");
    const fromDir = dirname(fromFile);
    // Walk up to find the package root (dir containing __init__.py or matching first part)
    let searchDirs = [fromDir];
    // Also try project root (parent dirs until no __init__.py)
    let d = fromDir;
    while (d !== dirname(d)) {
      const parent = dirname(d);
      if (existsSync(resolve(parent, parts[0])) || existsSync(resolve(parent, parts[0] + ".py"))) {
        searchDirs.push(parent);
        break;
      }
      d = parent;
    }
    for (const root of searchDirs) {
      const modulePath = resolve(root, ...parts);
      // Try as file: engine/board.py
      const asFile = modulePath + ".py";
      if (existsSync(asFile)) return asFile;
      // Try as package: engine/board/__init__.py
      const asPackage = resolve(modulePath, "__init__.py");
      if (existsSync(asPackage)) return asPackage;
    }
  }

  return null;
}

/**
 * Build raw dependency graph: files + forward/reverse edge maps.
 * Extracted so blast_radius and other analyses can reuse the graph.
 * L1 mtime cache prevents redundant rebuilds within the same audit cycle.
 */
export function buildRawGraph(targetPath, maxDepth = 5, extensions) {
  const target = resolve(targetPath);
  const stat_ = statSync(target, { throwIfNoEntry: false });
  if (!stat_) return { error: `Not found: ${target}` };

  // L1 cache: same path+depth+extensions → return cached graph if recent (<5s)
  // Uses time-based TTL instead of mtime to avoid recursive stat overhead (~55ms)
  const rawCacheKey = `rawgraph|${target}|${maxDepth}|${extensions || "default"}`;
  const cached = CACHE.get(rawCacheKey);
  if (cached && (Date.now() - cached.time) < 5000) return cached.result;

  const extSet = extensions
    ? new Set(extensions.split(","))
    : CODE_EXT;
  const extArr = [...extSet];

  const files = stat_.isDirectory()
    ? walkDir(target, extSet, maxDepth)
    : [target];

  const fileSet = new Set(files.map(f => f.replace(/\\/g, "/")));

  const edges = new Map();
  const inEdges = new Map();

  for (const file of files) {
    const norm = file.replace(/\\/g, "/");
    if (!edges.has(norm)) edges.set(norm, new Set());
    if (!inEdges.has(norm)) inEdges.set(norm, new Set());

    const imports = extractImports(file);
    for (const spec of imports) {
      const resolved = resolveImportPath(file, spec, extArr);
      if (!resolved) continue;
      const resolvedNorm = resolved.replace(/\\/g, "/");
      if (!fileSet.has(resolvedNorm)) continue;

      edges.get(norm).add(resolvedNorm);
      if (!inEdges.has(resolvedNorm)) inEdges.set(resolvedNorm, new Set());
      inEdges.get(resolvedNorm).add(norm);
    }
  }

  const result = { files, edges, inEdges, fileSet };
  CACHE.set(rawCacheKey, { time: Date.now(), result });
  return result;
}

function buildDependencyGraph(targetPath, maxDepth, extensions) {
  const raw = buildRawGraph(targetPath, maxDepth, extensions);
  if (raw.error) return raw;
  const { files, edges, inEdges } = raw;

  const cwd = process.cwd();

  // Topological sort (Kahn's algorithm)
  const inDegree = new Map();
  for (const f of files) {
    const norm = f.replace(/\\/g, "/");
    inDegree.set(norm, (inEdges.get(norm) || new Set()).size);
  }
  const queue = [];
  for (const [f, deg] of inDegree) {
    if (deg === 0) queue.push(f);
  }
  const topoOrder = [];
  const visited = new Set();
  while (queue.length > 0) {
    const f = queue.shift();
    if (visited.has(f)) continue;
    visited.add(f);
    topoOrder.push(f);
    for (const dep of (edges.get(f) || [])) {
      inDegree.set(dep, (inDegree.get(dep) || 1) - 1);
      if (inDegree.get(dep) === 0) queue.push(dep);
    }
  }
  const cycleFiles = files.map(f => f.replace(/\\/g, "/")).filter(f => !visited.has(f));

  // Connected components (undirected)
  const componentOf = new Map();
  let componentId = 0;
  const undirectedAdj = new Map();
  for (const f of files) {
    const norm = f.replace(/\\/g, "/");
    if (!undirectedAdj.has(norm)) undirectedAdj.set(norm, new Set());
    for (const dep of (edges.get(norm) || [])) {
      undirectedAdj.get(norm).add(dep);
      if (!undirectedAdj.has(dep)) undirectedAdj.set(dep, new Set());
      undirectedAdj.get(dep).add(norm);
    }
  }
  const compVisited = new Set();
  const components = [];
  for (const f of files) {
    const norm = f.replace(/\\/g, "/");
    if (compVisited.has(norm)) continue;
    const comp = [];
    const stack = [norm];
    while (stack.length > 0) {
      const n = stack.pop();
      if (compVisited.has(n)) continue;
      compVisited.add(n);
      comp.push(n);
      componentOf.set(n, componentId);
      for (const neighbor of (undirectedAdj.get(n) || [])) {
        if (!compVisited.has(neighbor)) stack.push(neighbor);
      }
    }
    components.push(comp);
    componentId++;
  }

  // Format output
  const rows = [];
  const totalEdges = [...edges.values()].reduce((s, e) => s + e.size, 0);

  rows.push("## Components\n");
  rows.push(`${components.length} connected components, ${files.length} files, ${totalEdges} edges\n`);
  for (let i = 0; i < components.length; i++) {
    const comp = components[i];
    if (comp.length === 1) continue;
    rows.push(`### Component ${i} (${comp.length} files)`);
    for (const f of comp.sort()) {
      rows.push(`  ${relative(cwd, f).replace(/\\/g, "/")}`);
    }
    rows.push("");
  }

  const connectedFiles = files
    .map(f => f.replace(/\\/g, "/"))
    .filter(f => (edges.get(f)?.size || 0) > 0 || (inEdges.get(f)?.size || 0) > 0);

  if (connectedFiles.length > 0) {
    rows.push("## Dependencies\n");
    rows.push("| File | Imports | Imported By |");
    rows.push("|------|---------|-------------|");
    for (const f of connectedFiles.sort()) {
      const rel = relative(cwd, f).replace(/\\/g, "/");
      const deps = [...(edges.get(f) || [])].map(d => relative(cwd, d).replace(/\\/g, "/"));
      const revs = [...(inEdges.get(f) || [])].map(d => relative(cwd, d).replace(/\\/g, "/"));
      rows.push(`| ${rel} | ${deps.join(", ") || "—"} | ${revs.join(", ") || "—"} |`);
    }
    rows.push("");
  }

  if (topoOrder.length > 0) {
    rows.push("## Topological Order (safe execution sequence)\n");
    for (let i = 0; i < topoOrder.length; i++) {
      rows.push(`${i + 1}. ${relative(cwd, topoOrder[i]).replace(/\\/g, "/")}`);
    }
    rows.push("");
  }

  if (cycleFiles.length > 0) {
    rows.push("## Cycles Detected\n");
    rows.push("These files have circular dependencies and cannot be topologically sorted:\n");
    for (const f of cycleFiles.sort()) {
      rows.push(`- ${relative(cwd, f).replace(/\\/g, "/")}`);
    }
  }

  const singletons = components.filter(c => c.length === 1);
  if (singletons.length > 0) {
    rows.push(`\n## Isolated Files (${singletons.length})\n`);
    rows.push("No imports from/to other files in scope.\n");
  }

  return {
    text: rows.join("\n"),
    summary: `${files.length} files, ${totalEdges} edges, ${components.length} components` +
      (cycleFiles.length > 0 ? `, ${cycleFiles.length} in cycles` : ""),
    json: {
      files: files.length,
      edges: totalEdges,
      components: components.length,
      cycles: cycleFiles.length,
    },
  };
}

export function toolDependencyGraph(params) {
  const { path: targetPath, depth = 5, extensions } = params;
  if (!targetPath) return { error: "path is required" };

  const pathCheck = safePathOrError(targetPath);
  if (pathCheck.error) return pathCheck;
  const cacheKey = getCacheKey(targetPath, "depgraph", depth);
  const target = pathCheck.path;
  const latestMtime = getLatestMtime(target);
  const cached = CACHE.get(cacheKey);
  if (cached && cached.mtime >= latestMtime) {
    return { ...cached.result, cached: true };
  }

  const result = buildDependencyGraph(targetPath, depth, extensions);
  if (result.error) return result;

  CACHE.set(cacheKey, { mtime: latestMtime, result });
  return result;
}

// ═══ Tool: blast_radius ══════════════════════════════════════════════════

/**
 * BFS on inEdges from changed files → transitive dependents.
 * @param {Map<string, Set<string>>} inEdges — reverse import edges
 * @param {string[]} changedFiles — seed files (absolute, normalized)
 * @param {number} maxDepth — BFS depth limit
 * @returns {{ affected: Map<string, {depth: number, via: string|null}>, maxDepthReached: boolean }}
 */
export function computeBlastRadiusFromGraph(inEdges, changedFiles, maxDepth = 10) {
  const affected = new Map();
  const queue = [];
  let head = 0; // index-based dequeue: O(1) instead of Array.shift() O(n)

  for (const f of changedFiles) {
    affected.set(f, { depth: 0, via: null });
    queue.push([f, 0]);
  }

  let maxDepthReached = false;
  while (head < queue.length) {
    const [file, depth] = queue[head++];
    if (depth >= maxDepth) { maxDepthReached = true; continue; }
    for (const importer of (inEdges.get(file) || [])) {
      if (!affected.has(importer)) {
        affected.set(importer, { depth: depth + 1, via: file });
        queue.push([importer, depth + 1]);
      }
    }
  }

  return { affected, maxDepthReached };
}

/**
 * Full blast radius: build graph + BFS from changed files.
 * @param {string} repoRoot — repository root path
 * @param {string[]} changedFiles — absolute paths of changed files
 * @param {number} maxDepth — BFS depth limit (default 10)
 */
export function computeBlastRadius(repoRoot, changedFiles, maxDepth = 10) {
  const raw = buildRawGraph(repoRoot, 5, null);
  if (raw.error) return { error: raw.error };

  const normalized = changedFiles
    .map(f => resolve(f).replace(/\\/g, "/"))
    .filter(f => raw.fileSet.has(f));

  if (normalized.length === 0) {
    return { affected: 0, total: raw.files.length, ratio: 0, maxDepthReached: false, files: [] };
  }

  const { affected, maxDepthReached } = computeBlastRadiusFromGraph(raw.inEdges, normalized, maxDepth);

  const cwd = process.cwd();
  const impactedFiles = [...affected.entries()]
    .filter(([, info]) => info.depth > 0)
    .sort((a, b) => a[1].depth - b[1].depth);

  return {
    affected: impactedFiles.length,
    total: raw.files.length,
    ratio: raw.files.length > 0 ? impactedFiles.length / raw.files.length : 0,
    maxDepthReached,
    files: impactedFiles.map(([file, info]) => ({
      file: relative(cwd, file).replace(/\\/g, "/"),
      depth: info.depth,
      via: info.via ? relative(cwd, info.via).replace(/\\/g, "/") : null,
    })),
  };
}

export function toolBlastRadius(params) {
  const { changed_files, path: repoPath, max_depth = 10 } = params;
  if (!changed_files || !Array.isArray(changed_files) || changed_files.length === 0) {
    return { error: "changed_files (string array) is required" };
  }

  const cwd = process.cwd();
  const rootCheck = safePathOrError(repoPath, cwd);
  if (rootCheck.error) return rootCheck;
  const root = rootCheck.path;

  const cacheKey = `blast|${root}|${changed_files.sort().join(",")}|${max_depth}`;
  const latestMtime = getLatestMtime(root);
  const cached = CACHE.get(cacheKey);
  if (cached && cached.mtime >= latestMtime) {
    return { ...cached.result, cached: true };
  }

  const result = computeBlastRadius(root, changed_files.map(f => resolve(cwd, f)), max_depth);
  if (result.error) return result;

  const rows = ["## Blast Radius Analysis\n"];
  rows.push(`**Changed**: ${changed_files.length} file(s)`);
  rows.push(`**Affected**: ${result.affected} / ${result.total} files (${(result.ratio * 100).toFixed(1)}%)`);
  if (result.maxDepthReached) {
    rows.push(`**Warning**: max depth (${max_depth}) reached — actual radius may be larger`);
  }

  if (result.files.length > 0) {
    rows.push("\n| Affected File | Depth | Via |");
    rows.push("|---------------|------:|-----|");
    for (const f of result.files.slice(0, 50)) {
      rows.push(`| ${f.file} | ${f.depth} | ${f.via || "direct"} |`);
    }
    if (result.files.length > 50) {
      rows.push(`\n_...and ${result.files.length - 50} more files_`);
    }
  }

  const output = {
    text: rows.join("\n"),
    summary: `${result.affected}/${result.total} files affected (${(result.ratio * 100).toFixed(1)}%)`,
    json: result,
  };

  CACHE.set(cacheKey, { mtime: latestMtime, result: output });
  return output;
}

// ═══ Tool: rtm_merge ════════════════════════════════════════════════════

function parseRtmTable(content) {
  const rows = new Map();
  const lines = content.split(/\r?\n/);
  let inTable = false;
  let headerCols = [];

  for (const line of lines) {
    if (!line.startsWith("|")) { inTable = false; continue; }

    const cells = line.split("|").map(c => c.trim()).filter((_, i, a) => i > 0 && i < a.length);

    if (!inTable && cells.some(c => /Req\s*ID/i.test(c))) {
      headerCols = cells;
      inTable = true;
      continue;
    }
    if (inTable && cells.every(c => c === "" || /^[-:]+$/.test(c))) continue;

    if (!inTable) continue;

    const reqIdx = headerCols.findIndex(c => /Req\s*ID/i.test(c));
    const fileIdx = headerCols.findIndex(c => /^File$/i.test(c));
    if (reqIdx < 0 || fileIdx < 0 || reqIdx >= cells.length || fileIdx >= cells.length) continue;

    const key = `${cells[reqIdx]}|${cells[fileIdx]}`;
    rows.set(key, { cells, raw: line });
  }
  return rows;
}

export function toolRtmMerge(params) {
  const { base, updates } = params;
  if (!base) return { error: "base path is required" };
  if (!updates || !Array.isArray(updates) || updates.length === 0) {
    return { error: "updates array is required (paths to worktree RTM files)" };
  }

  const baseCheck = safePathOrError(base);
  if (baseCheck.error) return baseCheck;
  for (const u of updates) { const c = safePathOrError(u); if (c.error) return c; }
  const basePath = baseCheck.path;
  if (!existsSync(basePath)) return { error: `Base RTM not found: ${base}` };
  const baseContent = readFileSync(basePath, "utf8");
  const baseRows = parseRtmTable(baseContent);

  const merged = new Map(baseRows);
  const conflicts = [];
  const additions = [];
  const updates_applied = [];
  const sourceMap = new Map();

  for (const updatePath of updates) {
    const fullPath = resolve(updatePath);
    if (!existsSync(fullPath)) {
      conflicts.push({ path: updatePath, error: "file not found" });
      continue;
    }
    const updateContent = readFileSync(fullPath, "utf8");
    const updateRows = parseRtmTable(updateContent);

    for (const [key, row] of updateRows) {
      if (!merged.has(key)) {
        merged.set(key, row);
        sourceMap.set(key, updatePath);
        additions.push({ key, source: updatePath });
      } else {
        const existing = merged.get(key);
        if (sourceMap.has(key) && sourceMap.get(key) !== updatePath) {
          conflicts.push({
            key,
            sources: [sourceMap.get(key), updatePath],
            base: existing.raw,
            update: row.raw,
          });
        } else if (existing.raw !== row.raw) {
          merged.set(key, row);
          sourceMap.set(key, updatePath);
          updates_applied.push({ key, source: updatePath });
        }
      }
    }
  }

  const output = [];
  output.push("## RTM Merge Result\n");
  output.push(`- Base: ${base}`);
  output.push(`- Updates: ${updates.length} files`);
  output.push(`- Rows: ${merged.size} total, ${updates_applied.length} updated, ${additions.length} added, ${conflicts.length} conflicts\n`);

  if (conflicts.length > 0) {
    output.push("### Conflicts (require manual resolution)\n");
    for (const c of conflicts) {
      if (c.error) {
        output.push(`- **${c.path}**: ${c.error}`);
      } else {
        output.push(`- **${c.key}**: modified by \`${c.sources[0]}\` and \`${c.sources[1]}\``);
        output.push(`  - Source 1: ${c.base}`);
        output.push(`  - Source 2: ${c.update}`);
      }
    }
    output.push("");
  }

  if (updates_applied.length > 0) {
    output.push("### Updated Rows\n");
    output.push("| Req ID | File | Source |");
    output.push("|--------|------|--------|");
    for (const u of updates_applied) {
      const [reqId, file] = u.key.split("|");
      const rel = relative(process.cwd(), u.source).replace(/\\/g, "/");
      output.push(`| ${reqId} | ${file} | ${rel} |`);
    }
    output.push("");
  }

  if (additions.length > 0) {
    output.push("### New Rows (discovered)\n");
    output.push("| Req ID | File | Source |");
    output.push("|--------|------|--------|");
    for (const a of additions) {
      const [reqId, file] = a.key.split("|");
      const rel = relative(process.cwd(), a.source).replace(/\\/g, "/");
      output.push(`| ${reqId} | ${file} | ${rel} |`);
    }
    output.push("");
  }

  output.push("### Merged Forward RTM\n");
  const allRows = [...merged.values()];
  if (allRows.length > 0) {
    const headers = ["Req ID", "Description", "Track", "Design Ref", "File", "Exists", "Impl", "Test Case", "Test Result", "Connected", "Status"];
    output.push("| " + allRows[0].cells.map((_, i) => headers[i] || `Col${i}`).join(" | ") + " |");
    output.push("|" + allRows[0].cells.map(() => "---").join("|") + "|");
    for (const row of allRows) {
      output.push(row.raw);
    }
  }

  return {
    text: output.join("\n"),
    summary: `${merged.size} rows, ${updates_applied.length} updated, ${additions.length} added, ${conflicts.length} conflicts`,
    json: {
      total: merged.size,
      updated: updates_applied.length,
      added: additions.length,
      conflicts: conflicts.length,
    },
  };
}

// ═══ Tool: rtm_parse ════════════════════════════════════════════════════

export function toolRtmParse(params) {
  const { path: targetPath, matrix = "forward", req_id, status: statusFilter } = params;
  if (!targetPath) return { error: "path is required" };

  const pathCheck = safePathOrError(targetPath);
  if (pathCheck.error) return pathCheck;
  const fullPath = pathCheck.path;
  if (!existsSync(fullPath)) return { error: `Not found: ${targetPath}` };

  const content = readFileSync(fullPath, "utf8");
  const lines = content.split(/\r?\n/);

  const matrixPatterns = {
    forward:       /^##\s+(?:순방향|Forward)\s+RTM/i,
    backward:      /^##\s+(?:역방향|Backward)\s+RTM/i,
    bidirectional: /^##\s+(?:양방향|Bidirectional)\s+RTM/i,
  };
  const sectionRe = matrixPatterns[matrix];
  if (!sectionRe) return { error: `Unknown matrix type: ${matrix}. Use: forward, backward, bidirectional` };

  let sectionStart = -1;
  for (let i = 0; i < lines.length; i++) {
    if (sectionRe.test(lines[i].trim())) { sectionStart = i; break; }
  }
  const searchStart = sectionStart >= 0 ? sectionStart : 0;

  let headerLine = -1;
  let headerCols = [];
  const rows = [];

  for (let i = searchStart; i < lines.length; i++) {
    const line = lines[i];

    if (i > searchStart && /^##\s+/.test(line) && sectionStart >= 0) break;

    if (!line.startsWith("|")) continue;
    const cells = line.split("|").map(c => c.trim()).filter((_, idx, a) => idx > 0 && idx < a.length);

    if (headerLine < 0 && cells.some(c => /Req\s*ID|Test\s*File/i.test(c))) {
      headerCols = cells;
      headerLine = i;
      continue;
    }
    if (headerLine >= 0 && cells.every(c => c === "" || /^[-:]+$/.test(c))) continue;
    if (headerLine < 0) continue;

    const row = {};
    for (let j = 0; j < headerCols.length && j < cells.length; j++) {
      const key = headerCols[j]
        .toLowerCase()
        .replace(/\s+/g, "_")
        .replace(/[^a-z0-9_]/g, "");
      row[key] = cells[j];
    }
    rows.push(row);
  }

  let filtered = rows;
  if (req_id) {
    filtered = filtered.filter(r => (r.req_id || "").includes(req_id));
  }
  if (statusFilter) {
    filtered = filtered.filter(r => (r.status || "").toLowerCase() === statusFilter.toLowerCase());
  }

  const output = [];
  output.push(`## ${matrix} RTM — ${filtered.length} rows${req_id ? ` (filtered: ${req_id})` : ""}${statusFilter ? ` (status: ${statusFilter})` : ""}\n`);

  if (filtered.length === 0) {
    output.push("No matching rows found.");
  } else {
    output.push("| " + headerCols.join(" | ") + " |");
    output.push("|" + headerCols.map(() => "---").join("|") + "|");
    for (const row of filtered) {
      const cells = headerCols.map(h => {
        const key = h.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
        return row[key] || "—";
      });
      output.push("| " + cells.join(" | ") + " |");
    }

    if (matrix === "forward") {
      const statuses = {};
      for (const r of filtered) {
        const s = (r.status || "unknown").toLowerCase();
        statuses[s] = (statuses[s] || 0) + 1;
      }
      output.push("");
      output.push("**Status summary**: " + Object.entries(statuses).map(([k, v]) => `${k}: ${v}`).join(", "));
    }
  }

  return {
    text: output.join("\n"),
    summary: `${filtered.length}/${rows.length} rows`,
    json: {
      matrix,
      total: rows.length,
      filtered: filtered.length,
      rows: filtered,
    },
  };
}

// ═══ Tool: audit_history ════════════════════════════════════════════════

export function toolAuditHistory(params) {
  const { path: historyPath, track, code, since, summary = false } = params;
  if (historyPath) { const c = safePathOrError(historyPath); if (c.error) return c; }

  const defaultPath = resolve(process.cwd(), ".claude", "audit-history.jsonl");
  const fullPath = historyPath ? resolve(historyPath) : defaultPath;

  if (!existsSync(fullPath)) {
    return { text: `No audit history yet. The file ${fullPath} will be created automatically after the first audit verdict (respond.mjs appends to it).`, summary: "0 entries", json: { total: 0 } };
  }

  let entries = readJsonlFile(fullPath);

  if (track) {
    entries = entries.filter(e => (e.track || "").toLowerCase().includes(track.toLowerCase()));
  }
  if (code) {
    entries = entries.filter(e =>
      (e.rejection_codes || []).some(rc =>
        (typeof rc === "string" ? rc : rc.code || "").includes(code)
      )
    );
  }
  if (since) {
    const sinceMs = new Date(since).getTime();
    if (!isNaN(sinceMs)) {
      entries = entries.filter(e => new Date(e.timestamp).getTime() >= sinceMs);
    }
  }

  if (entries.length === 0) {
    return { text: "No matching audit history entries.", summary: "0 entries", json: { total: 0 } };
  }

  const output = [];

  if (summary) {
    const byVerdict = { agree: 0, pending: 0 };
    const byTrack = {};
    const byCode = {};
    let totalRounds = 0;

    for (const e of entries) {
      byVerdict[e.verdict] = (byVerdict[e.verdict] || 0) + 1;
      if (e.track) byTrack[e.track] = (byTrack[e.track] || 0) + 1;
      for (const rc of (e.rejection_codes || [])) {
        const c = typeof rc === "string" ? rc : rc.code || "unknown";
        byCode[c] = (byCode[c] || 0) + 1;
      }
      totalRounds++;
    }

    output.push("## Audit History Summary\n");
    output.push(`- Total entries: ${totalRounds}`);
    output.push(`- Agree: ${byVerdict.agree || 0}, Pending: ${byVerdict.pending || 0}`);
    output.push(`- Approval rate: ${totalRounds > 0 ? Math.round(((byVerdict.agree || 0) / totalRounds) * 100) : 0}%\n`);

    if (Object.keys(byTrack).length > 0) {
      output.push("### By Track\n");
      output.push("| Track | Entries |");
      output.push("|-------|--------|");
      for (const [t, count] of Object.entries(byTrack).sort((a, b) => b[1] - a[1])) {
        output.push(`| ${t} | ${count} |`);
      }
      output.push("");
    }

    if (Object.keys(byCode).length > 0) {
      output.push("### By Rejection Code\n");
      output.push("| Code | Count |");
      output.push("|------|-------|");
      for (const [c, count] of Object.entries(byCode).sort((a, b) => b[1] - a[1])) {
        output.push(`| ${c} | ${count} |`);
      }
      output.push("");
    }

    const patterns = [];
    for (const [c, count] of Object.entries(byCode)) {
      if (count >= 3) patterns.push(`⚠️ \`${c}\` appeared ${count} times — structural issue likely`);
    }
    if (patterns.length > 0) {
      output.push("### Risk Patterns\n");
      for (const p of patterns) output.push(`- ${p}`);
    }

    return {
      text: output.join("\n"),
      summary: `${totalRounds} entries, ${byVerdict.agree || 0} agree, ${byVerdict.pending || 0} pending`,
      json: { total: totalRounds, byVerdict, byTrack, byCode },
    };
  }

  // Detail mode
  output.push("## Audit History\n");
  output.push("| Timestamp | Track | Verdict | Req IDs | Rejection Codes |");
  output.push("|-----------|-------|---------|---------|-----------------|");

  for (const e of entries.slice(-50)) {
    const codes = (e.rejection_codes || []).map(rc =>
      typeof rc === "string" ? rc : `${rc.code}[${rc.severity}]`
    ).join(", ") || "—";
    const reqIds = (e.req_ids || []).join(", ") || "—";
    const ts = e.timestamp ? e.timestamp.slice(0, 16).replace("T", " ") : "—";
    output.push(`| ${ts} | ${e.track || "—"} | ${e.verdict} | ${reqIds} | ${codes} |`);
  }

  return {
    text: output.join("\n"),
    summary: `${entries.length} entries (showing last ${Math.min(entries.length, 50)})`,
    json: { total: entries.length, entries: entries.slice(-50) },
  };
}

// ═══ Tool: act_analyze ═══════════════════════════════════════════════════

/**
 * Analyze audit history + FVM results → produce structured improvement items
 * for the PDCA Act phase. Output is work-catalog-ready.
 */

const IMPROVEMENT_THRESHOLDS = {
  fp_rate_warn: 0.3,          // flag rejection code if FP rate > 30%
  repeat_rejection_warn: 3,   // flag if same code appears 3+ times on a track
  correction_rounds_warn: 3,  // flag if avg correction rounds > 3
  fvm_auth_leak_block: 1,     // any AUTH_LEAK is critical
  fvm_false_deny_warn: 0.2,   // flag if FALSE_DENY rate > 20%
};

export function toolActAnalyze(params) {
  const {
    audit_history_path,
    fvm_results_path,
    track,
    thresholds: customThresholds,
  } = params;

  const T = { ...IMPROVEMENT_THRESHOLDS, ...customThresholds };
  const cwd = process.cwd();
  const items = [];
  let auditMetrics = null;
  let fvmMetrics = null;

  // ── Audit history analysis ──

  const histPath = audit_history_path
    ? resolve(audit_history_path)
    : resolve(cwd, ".claude", "audit-history.jsonl");

  if (existsSync(histPath)) {
    let entries = readJsonlFile(histPath);
    if (track) {
      entries = entries.filter(e => (e.track || "").toLowerCase().includes(track.toLowerCase()));
    }

    if (entries.length > 0) {
      // Compute metrics
      const byCode = {};
      const byTrack = {};
      const byVerdict = { agree: 0, pending: 0 };
      let totalRounds = 0;

      for (const e of entries) {
        byVerdict[e.verdict] = (byVerdict[e.verdict] || 0) + 1;
        if (e.track) byTrack[e.track] = (byTrack[e.track] || 0) + 1;
        for (const rc of (e.rejection_codes || [])) {
          const c = typeof rc === "string" ? rc : rc.code || "unknown";
          byCode[c] = (byCode[c] || 0) + 1;
        }
        totalRounds++;
      }

      const approvalRate = totalRounds > 0 ? (byVerdict.agree || 0) / totalRounds : 1;
      const avgCorrections = totalRounds > 0
        ? (byVerdict.pending || 0) / Math.max(byVerdict.agree || 1, 1)
        : 0;

      auditMetrics = {
        total: totalRounds,
        approval_rate: Math.round(approvalRate * 100),
        avg_corrections: Math.round(avgCorrections * 10) / 10,
        by_code: byCode,
        by_track: byTrack,
      };

      // Generate improvement items from audit patterns
      for (const [code, count] of Object.entries(byCode)) {
        if (count >= T.repeat_rejection_warn) {
          items.push({
            id: `ACT-A-${items.length + 1}`,
            type: "policy",
            source: "audit_history",
            metric: `${code}: ${count} rejections`,
            description: `Rejection code \`${code}\` appeared ${count} times — review policy in rejection-codes.md`,
            priority: count >= 5 ? "high" : "medium",
            target_file: `templates/references/\${locale}/rejection-codes.md`,
          });
        }
      }

      if (avgCorrections > T.correction_rounds_warn) {
        items.push({
          id: `ACT-A-${items.length + 1}`,
          type: "process",
          source: "audit_history",
          metric: `avg ${auditMetrics.avg_corrections} correction rounds`,
          description: `Average correction rounds (${auditMetrics.avg_corrections}) exceeds threshold (${T.correction_rounds_warn}) — review evidence format or done-criteria clarity`,
          priority: "high",
          target_file: `templates/references/\${locale}/evidence-format.md`,
        });
      }
    }
  }

  // ── FVM results analysis ──

  if (fvm_results_path && existsSync(resolve(fvm_results_path))) {
    const fvmContent = readFileSync(resolve(fvm_results_path), "utf8");

    // Parse summary line: "N rows, N passed, N failed"
    const summaryMatch = fvmContent.match(/Total:\s*(\d+)\s*rows?,\s*(\d+)\s*passed,\s*(\d+)\s*failed/i);
    if (summaryMatch) {
      const total = parseInt(summaryMatch[1]);
      const passed = parseInt(summaryMatch[2]);
      const failed = parseInt(summaryMatch[3]);

      // Count failure types from table
      const authLeaks = (fvmContent.match(/AUTH_LEAK/g) || []).length;
      const falseDenies = (fvmContent.match(/FALSE_DENY/g) || []).length;
      const paramErrors = (fvmContent.match(/PARAM_ERROR/g) || []).length;

      fvmMetrics = {
        total, passed, failed,
        pass_rate: total > 0 ? Math.round((passed / total) * 100) : 0,
        auth_leaks: authLeaks,
        false_denies: falseDenies,
        param_errors: paramErrors,
      };

      if (authLeaks >= T.fvm_auth_leak_block) {
        items.push({
          id: `ACT-F-${items.length + 1}`,
          type: "security",
          source: "fvm_validate",
          metric: `${authLeaks} AUTH_LEAK(s)`,
          description: `${authLeaks} endpoint(s) accessible by unauthorized roles — add auth guards`,
          priority: "critical",
          target_file: "src/dashboard/routes/",
        });
      }

      if (total > 0 && falseDenies / total > T.fvm_false_deny_warn) {
        items.push({
          id: `ACT-F-${items.length + 1}`,
          type: "tooling",
          source: "fvm_validate",
          metric: `${falseDenies} FALSE_DENY (${Math.round(falseDenies / total * 100)}%)`,
          description: `FVM FALSE_DENY rate ${Math.round(falseDenies / total * 100)}% — improve fvm_generate page-to-endpoint tier mapping`,
          priority: "medium",
          target_file: "scripts/fvm-generator.mjs",
        });
      }

      if (paramErrors > 0) {
        items.push({
          id: `ACT-F-${items.length + 1}`,
          type: "testing",
          source: "fvm_validate",
          metric: `${paramErrors} PARAM_ERROR(s)`,
          description: `${paramErrors} endpoint(s) return 400/422 — add request body fixtures to FVM validator`,
          priority: "low",
          target_file: "scripts/fvm-validator.mjs",
        });
      }
    }
  }

  // ── Format output ──

  const out = [];
  out.push("## Act Analysis — PDCA Improvement Items\n");
  out.push(`Generated: ${new Date().toISOString()}\n`);

  // Metrics summary
  if (auditMetrics) {
    out.push("### Audit Metrics\n");
    out.push(`- Total rounds: ${auditMetrics.total}`);
    out.push(`- Approval rate: ${auditMetrics.approval_rate}%`);
    out.push(`- Avg correction rounds: ${auditMetrics.avg_corrections}`);
    const topCodes = Object.entries(auditMetrics.by_code).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([c, n]) => `${c}(${n})`).join(", ");
    out.push(`- Top rejection codes: ${topCodes}`);
    out.push("");
  }

  if (fvmMetrics) {
    out.push("### FVM Metrics\n");
    out.push(`- Pass rate: ${fvmMetrics.pass_rate}% (${fvmMetrics.passed}/${fvmMetrics.total})`);
    out.push(`- AUTH_LEAK: ${fvmMetrics.auth_leaks}`);
    out.push(`- FALSE_DENY: ${fvmMetrics.false_denies}`);
    out.push(`- PARAM_ERROR: ${fvmMetrics.param_errors}`);
    out.push("");
  }

  // Improvement items in work-catalog format
  if (items.length > 0) {
    out.push("### Improvement Items (work-catalog format)\n");
    out.push("| ID | Type | Priority | Source | Description | Target |");
    out.push("|---|---|---|---|---|---|");
    for (const item of items) {
      out.push(`| ${item.id} | ${item.type} | ${item.priority} | ${item.source} | ${item.description} | ${item.target_file} |`);
    }
    out.push("");
    out.push("**Action**: Append approved items to the track's `work-catalog.md` under a new `## Act Improvements` section.");
  } else {
    out.push("### No Improvement Items\n");
    out.push("All metrics within thresholds. No structural improvements needed this cycle.");
  }

  const summary = `${items.length} improvement items` +
    (auditMetrics ? `, audit: ${auditMetrics.approval_rate}% approval` : "") +
    (fvmMetrics ? `, fvm: ${fvmMetrics.pass_rate}% pass` : "");

  return {
    text: out.join("\n"),
    summary,
    json: {
      items,
      audit_metrics: auditMetrics,
      fvm_metrics: fvmMetrics,
      thresholds: T,
    },
  };
}

// ═══ Tool: perf_scan ════════════════════════════════════════════════════

const PERF_PATTERNS = [
  { re: /\.forEach\s*\([^)]*=>\s*\{[\s\S]{0,200}\.forEach/m, label: "nested-loop", severity: "high", msg: "Nested .forEach() — potential O(n²)" },
  { re: /\.filter\([^)]*\)\s*\.map\(/m, label: "chain-inefficiency", severity: "low", msg: "filter().map() — consider single reduce()" },
  { re: /readFileSync|writeFileSync|execSync/m, label: "sync-io", severity: "medium", msg: "Synchronous I/O — blocks event loop" },
  { re: /new RegExp\([^)]+\)/m, label: "dynamic-regex", severity: "low", msg: "Dynamic RegExp construction in potential hot path" },
  { re: /SELECT\s+\*\s+FROM/im, label: "select-star", severity: "medium", msg: "SELECT * — fetch only needed columns" },
  { re: /(?:import|require)\s*\(\s*["']lodash["']\s*\)/m, label: "heavy-import", severity: "medium", msg: "Full lodash import — use lodash/specific" },
  { re: /JSON\.parse\(.*readFileSync/m, label: "sync-json", severity: "medium", msg: "Sync file read + JSON.parse — consider async" },
  { re: /\.findAll\s*\(\s*\)/m, label: "unbounded-query", severity: "high", msg: "Unbounded findAll() — add limit/pagination" },
  { re: /while\s*\(\s*true\s*\)/m, label: "busy-loop", severity: "high", msg: "while(true) — potential busy loop" }, // scan-ignore: msg contains pattern text, triggers self-referential match
];

/**
 * Scan for performance anti-patterns: O(n²) loops, sync I/O in hot paths,
 * missing pagination, unbounded queries, large bundle imports.
 */
export function toolPerfScan(params) {
  const cwd = process.cwd();
  return runPatternScan({
    targetPath: params.path,
    extensions: _langRegistry?.extensionsForDomain("perf") ?? new Set([".ts", ".tsx", ".js", ".jsx", ".mjs"]),
    patterns: _gatherDomainPatterns("perf", PERF_PATTERNS),
    toolName: "perf_scan",
    heading: "Performance Scan Results",
    passMsg: "no performance anti-patterns detected",
    failNoun: "high-severity issue(s)",
    astRefine: _createAstRefine ? _createAstRefine(cwd) : null,
  });
}

// ═══ Tool: compat_check ═════════════════════════════════════════════════

const COMPAT_PATTERNS = [
  { re: /@deprecated/m, label: "deprecated-usage", severity: "medium", msg: "Contains @deprecated annotation" },
  { re: /\/\*\*[\s\S]*?@breaking[\s\S]*?\*\//m, label: "breaking-change", severity: "high", msg: "Marked as @breaking change" },
  { re: /(?:module\.exports|exports\.)\s*=\s*/m, label: "cjs-export", severity: "low", msg: "CommonJS export in ESM project" },
  { re: /require\s*\(\s*["'][^"']+["']\s*\)/m, label: "cjs-require", severity: "low", msg: "CommonJS require() in ESM project" },
  { re: /\/\/\s*TODO.*(?:remove|delete|deprecat)/im, label: "pending-removal", severity: "medium", msg: "Pending removal marked in TODO" },
];

/**
 * Check for breaking API changes: removed exports, changed function signatures,
 * deprecated usage, version constraint issues.
 */
export function toolCompatCheck(params) {
  return runPatternScan({
    targetPath: params.path,
    extensions: _langRegistry?.extensionsForDomain("compat") ?? new Set([".ts", ".tsx", ".js", ".jsx", ".mjs"]),
    patterns: _gatherDomainPatterns("compat", COMPAT_PATTERNS),
    toolName: "compat_check",
    heading: "Compatibility Check Results",
    passMsg: "no compatibility issues detected",
    failNoun: "breaking issue(s)",
    postProcess: (findings, _files, cwd) => {
      const pkgPath = resolve(cwd, "package.json");
      if (existsSync(pkgPath)) {
        try {
          const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
          const deps = { ...pkg.dependencies, ...pkg.devDependencies };
          for (const [name, ver] of Object.entries(deps)) {
            if (typeof ver === "string" && ver.startsWith("*")) {
              findings.push({ file: "package.json", line: 0, severity: "high", label: "wildcard-dep", msg: `Wildcard version for ${name}: ${ver}` });
            }
          }
        } catch { /* skip */ }
      }
    },
  });
}

// ═══ Tool: a11y_scan ════════════════════════════════════════════════════

const A11Y_PATTERNS = [
  { re: /<img\s+(?![^>]*alt\s*=)/m, label: "img-no-alt", severity: "high", msg: "<img> missing alt attribute" },
  { re: /<(?!button\b)\w+\s+onClick/m, label: "click-no-keyboard", severity: "medium", msg: "Non-button element with onClick — add keyboard handler or use <button>" },
  { re: /<div\s+onClick/m, label: "div-click", severity: "medium", msg: "<div> with onClick — use <button> or add role" },
  { re: /<(?:input|textarea|select)\s+(?![^>]*(?:aria-label|aria-labelledby|id\s*=))/m, label: "form-no-label", severity: "high", msg: "Form element missing label association" },
  { re: /tabIndex\s*=\s*\{?\s*-1/m, label: "negative-tabindex", severity: "low", msg: "Negative tabIndex removes from tab order" },
  { re: /aria-hidden\s*=\s*["']true["'][\s\S]{0,50}onClick/m, label: "hidden-interactive", severity: "high", msg: "aria-hidden on interactive element" },
  { re: /<a\s+(?![^>]*href)/m, label: "anchor-no-href", severity: "medium", msg: "<a> without href — not keyboard accessible" },
  { re: /style\s*=\s*\{\s*\{[^}]*display\s*:\s*["']?none/m, label: "css-hidden", severity: "low", msg: "CSS display:none — verify not hiding from assistive tech" },
];

/**
 * Scan JSX/TSX files for accessibility anti-patterns:
 * missing alt, missing aria-label, onClick without keyboard, no role, etc.
 */
export function toolA11yScan(params) {
  // Pre-check: skip if no JSX/TSX files exist
  const cwd = process.cwd();
  const target = resolve(params.path || cwd);
  const stat_ = statSync(target, { throwIfNoEntry: false });
  if (!stat_) return { error: `Not found: ${target}` };
  const jsxExt = new Set([".tsx", ".jsx"]);
  const jsxFiles = stat_.isDirectory() ? walkDir(target, jsxExt, 5) : [target];
  if (jsxFiles.length === 0) {
    return { text: "a11y_scan: skip — no JSX/TSX files found.", summary: "0 JSX files" };
  }

  return runPatternScan({
    targetPath: params.path,
    extensions: jsxExt,
    patterns: A11Y_PATTERNS,
    toolName: "a11y_scan",
    heading: "Accessibility Scan Results",
    passMsg: "no accessibility issues detected",
    failNoun: "critical a11y violation(s)",
  });
}

// ═══ Tool: license_scan ═════════════════════════════════════════════════

const PII_PATTERNS = [
  { re: /(?:password|passwd|secret|api_?key|token)\s*[:=]\s*["'][^"']{3,}/im, label: "hardcoded-secret", severity: "high", msg: "Potential hardcoded secret" },
  { re: /\b\d{3}-\d{2}-\d{4}\b/m, label: "ssn-pattern", severity: "high", msg: "SSN-like pattern in source" },
  { re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z]{2,}\b/im, label: "email-literal", severity: "low", msg: "Hardcoded email address" },
];

/**
 * Check dependency licenses for copyleft/unknown risks,
 * PII patterns in source, and security-sensitive imports.
 */
export function toolLicenseScan(params) {
  const { path: targetPath } = params;
  const cwd = process.cwd();
  const target = resolve(targetPath || cwd);

  const findings = [];

  // 1. Check package.json license field
  const pkgPath = resolve(target, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
      if (!pkg.license) {
        findings.push({ file: "package.json", line: 0, severity: "medium", label: "no-license", msg: "No license field in package.json" });
      }

      // Check dependencies for known copyleft
      const COPYLEFT = /GPL|AGPL|SSPL|EUPL|CC-BY-SA/i;
      const PERMISSIVE = /MIT|ISC|BSD|Apache|Unlicense|0BSD/i;
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };

      // Read node_modules package.json for license info
      for (const depName of Object.keys(deps)) {
        const depPkgPath = resolve(target, "node_modules", depName, "package.json");
        if (!existsSync(depPkgPath)) continue;
        try {
          const depPkg = JSON.parse(readFileSync(depPkgPath, "utf8"));
          const lic = depPkg.license || depPkg.licenses?.[0]?.type || "";
          if (COPYLEFT.test(lic)) {
            findings.push({ file: `node_modules/${depName}`, line: 0, severity: "high", label: "copyleft-dep", msg: `Copyleft license: ${lic}` });
          } else if (!PERMISSIVE.test(lic) && lic) {
            findings.push({ file: `node_modules/${depName}`, line: 0, severity: "low", label: "unknown-license", msg: `Non-standard license: ${lic}` });
          }
        } catch { /* skip */ }
      }
    } catch { /* skip */ }
  }

  // 2. Scan source for PII patterns
  const extSet = _langRegistry?.allExtensions() ?? new Set([".ts", ".tsx", ".js", ".jsx", ".mjs"]);
  const stat_ = statSync(target, { throwIfNoEntry: false });
  const files = stat_?.isDirectory() ? walkDir(target, extSet, 5) : [];

  for (const file of files) {
    let content;
    try { content = readFileSync(file, "utf8"); } catch { continue; }
    const lines = content.split(/\r?\n/);
    const spec = _langRegistry?.forFile(file);
    const cPrefixes = spec?.commentPrefixes ?? ["//", "*"];

    for (let i = 0; i < lines.length; i++) {
      if (cPrefixes.some(p => lines[i].trimStart().startsWith(p))) continue;
      for (const pat of PII_PATTERNS) {
        if (pat.re.test(lines[i])) {
          findings.push({
            file: relative(cwd, file).replace(/\\/g, "/"),
            line: i + 1,
            severity: pat.severity,
            label: pat.label,
            msg: pat.msg,
          });
        }
      }
    }
  }

  if (findings.length === 0) {
    return { text: "license_scan: pass — no compliance issues detected.", summary: `${files.length} files scanned, 0 findings` };
  }

  const rows = ["## License & Compliance Scan Results\n"];
  rows.push("| File | Line | Severity | Issue |");
  rows.push("|------|------|----------|-------|");
  for (const f of findings) {
    rows.push(`| ${f.file} | ${f.line} | ${f.severity} | ${f.msg} |`);
  }

  const highCount = findings.filter(f => f.severity === "high").length;
  const verdict = highCount > 0 ? `fail — ${highCount} compliance violation(s)` : `warn — ${findings.length} note(s)`;
  rows.push(`\n**Verdict**: ${verdict}`);

  return {
    text: rows.join("\n"),
    summary: `${files.length} source files + deps, ${findings.length} findings (${highCount} high)`,
    json: { total: findings.length, high: highCount, findings },
  };
}

// ═══ Tool: i18n_validate ════════════════════════════════════════════════

const HARDCODED_RE = />\s*[A-Z가-힣][A-Za-z가-힣\s]{2,30}\s*</m;

/**
 * Validate i18n locale parity: ensure all keys exist in all locale files,
 * detect hardcoded user-facing strings in components.
 */
export function toolI18nValidate(params) {
  const { path: targetPath } = params;
  const cwd = process.cwd();
  const target = resolve(targetPath || cwd);

  const findings = [];

  // 1. Find locale JSON files
  const localeFiles = [];
  const localeDirs = [
    resolve(target, "locales"),
    resolve(target, "src", "locales"),
    resolve(target, "public", "locales"),
    resolve(target, "web", "src", "locales"),
  ];

  for (const dir of localeDirs) {
    if (!existsSync(dir)) continue;
    try {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (e.isFile() && e.name.endsWith(".json")) {
          localeFiles.push({ path: resolve(dir, e.name), name: e.name });
        }
        // Also check subdirectory pattern (locales/en/translation.json)
        if (e.isDirectory()) {
          const nested = resolve(dir, e.name);
          try {
            for (const f of readdirSync(nested)) {
              if (f.endsWith(".json")) {
                localeFiles.push({ path: resolve(nested, f), name: `${e.name}/${f}` });
              }
            }
          } catch { /* skip */ }
        }
      }
    } catch { /* skip */ }
  }

  if (localeFiles.length >= 2) {
    // Compare key sets across locale files
    const keysByFile = new Map();

    function flattenKeys(obj, prefix = "") {
      const keys = [];
      for (const [k, v] of Object.entries(obj)) {
        const full = prefix ? `${prefix}.${k}` : k;
        if (v && typeof v === "object" && !Array.isArray(v)) {
          keys.push(...flattenKeys(v, full));
        } else {
          keys.push(full);
        }
      }
      return keys;
    }

    for (const lf of localeFiles) {
      try {
        const data = JSON.parse(readFileSync(lf.path, "utf8"));
        keysByFile.set(lf.name, new Set(flattenKeys(data)));
      } catch {
        findings.push({ file: lf.name, line: 0, severity: "medium", label: "parse-error", msg: "Failed to parse locale file" });
      }
    }

    // Cross-compare
    const allFiles = [...keysByFile.keys()];
    for (let i = 0; i < allFiles.length; i++) {
      for (let j = i + 1; j < allFiles.length; j++) {
        const keysA = keysByFile.get(allFiles[i]);
        const keysB = keysByFile.get(allFiles[j]);
        if (!keysA || !keysB) continue;

        for (const k of keysA) {
          if (!keysB.has(k)) {
            findings.push({ file: allFiles[j], line: 0, severity: "high", label: "i18n-parity", msg: `Missing key: "${k}" (exists in ${allFiles[i]})` });
          }
        }
        for (const k of keysB) {
          if (!keysA.has(k)) {
            findings.push({ file: allFiles[i], line: 0, severity: "high", label: "i18n-parity", msg: `Missing key: "${k}" (exists in ${allFiles[j]})` });
          }
        }
      }
    }
  }

  // 2. Scan for hardcoded strings in JSX
  const jsxExt = new Set([".tsx", ".jsx"]);
  const stat_ = statSync(target, { throwIfNoEntry: false });
  const jsxFiles = stat_?.isDirectory() ? walkDir(target, jsxExt, 5) : [];

  for (const file of jsxFiles) {
    let content;
    try { content = readFileSync(file, "utf8"); } catch { continue; }
    const lines = content.split(/\r?\n/);

    for (let i = 0; i < lines.length; i++) {
      if (HARDCODED_RE.test(lines[i]) && !lines[i].includes("t(") && !lines[i].includes("i18n")) {
        findings.push({
          file: relative(cwd, file).replace(/\\/g, "/"),
          line: i + 1,
          severity: "medium",
          label: "i18n-hardcoded",
          msg: "Possible hardcoded UI text — use i18n key",
        });
      }
    }
  }

  const scannedCount = localeFiles.length + jsxFiles.length;

  if (findings.length === 0) {
    return { text: "i18n_validate: pass — locale parity OK, no hardcoded strings.", summary: `${scannedCount} files scanned, 0 findings` };
  }

  const rows = ["## i18n Validation Results\n"];
  rows.push("| File | Line | Severity | Issue |");
  rows.push("|------|------|----------|-------|");
  for (const f of findings.slice(0, 100)) {
    rows.push(`| ${f.file} | ${f.line} | ${f.severity} | ${f.msg} |`);
  }
  if (findings.length > 100) rows.push(`\n... and ${findings.length - 100} more`);

  const highCount = findings.filter(f => f.severity === "high").length;
  const verdict = highCount > 0 ? `fail — ${highCount} parity violation(s)` : `warn — ${findings.length} i18n issue(s)`;
  rows.push(`\n**Verdict**: ${verdict}`);

  return {
    text: rows.join("\n"),
    summary: `${scannedCount} files, ${findings.length} findings (${highCount} parity)`,
    json: { total: findings.length, high: highCount, localeFiles: localeFiles.length, findings: findings.slice(0, 100) },
  };
}

// ═══ Tool: infra_scan ═══════════════════════════════════════════════════

const INFRA_PATTERNS = [
  { re: /FROM\s+[^:\s]+\s*$/m, label: "no-tag", severity: "high", msg: "Docker FROM without version tag (uses :latest)" },
  { re: /FROM\s+\S+:latest/m, label: "latest-tag", severity: "high", msg: "Docker FROM uses :latest — pin version" },
  { re: /RUN\s+.*curl.*\|\s*(?:sh|bash)/m, label: "pipe-install", severity: "high", msg: "curl | sh — unverified remote execution" },
  { re: /EXPOSE\s+22\b/m, label: "ssh-exposed", severity: "medium", msg: "SSH port exposed in container" },
  { re: /privileged:\s*true/m, label: "privileged", severity: "high", msg: "Privileged container — security risk" },
  { re: /password|secret|api_key|token/im, label: "secret-in-config", severity: "high", msg: "Potential secret in config file" },
  { re: /USER\s+root/m, label: "root-user", severity: "medium", msg: "Container runs as root — use non-root user" },
  { re: /npm\s+install(?!\s+--production|\s+-P)/m, label: "dev-deps-in-prod", severity: "low", msg: "npm install without --production in Dockerfile" },
];

/**
 * Scan infrastructure files (Dockerfile, docker-compose, CI configs)
 * for security and reliability anti-patterns.
 */
export function toolInfraScan(params) {
  const { path: targetPath } = params;
  const cwd = process.cwd();
  const target = resolve(targetPath || cwd);

  const findings = [];

  // Find infra files
  const infraPatterns = [
    "Dockerfile", "docker-compose.yml", "docker-compose.yaml",
    ".github/workflows", ".gitlab-ci.yml", "Jenkinsfile",
    "nginx.conf", "Caddyfile", "terraform", ".env.example",
  ];

  const infraFiles = [];
  const allExts = new Set([".yml", ".yaml", ".toml", ".conf", ".tf", ".sh", ".dockerfile"]);
  const stat_ = statSync(target, { throwIfNoEntry: false });

  // Direct file checks
  for (const pat of infraPatterns) {
    const p = resolve(target, pat);
    const s = statSync(p, { throwIfNoEntry: false });
    if (s?.isFile()) infraFiles.push(p);
    if (s?.isDirectory()) {
      try {
        for (const e of readdirSync(p, { withFileTypes: true })) {
          if (e.isFile()) infraFiles.push(resolve(p, e.name));
        }
      } catch { /* skip */ }
    }
  }

  // Also check for Dockerfile* patterns
  if (stat_?.isDirectory()) {
    try {
      for (const e of readdirSync(target)) {
        if (e.startsWith("Dockerfile") || e.startsWith("docker-compose") || e === ".dockerignore") {
          infraFiles.push(resolve(target, e));
        }
      }
    } catch { /* skip */ }
  }

  if (infraFiles.length === 0) {
    return { text: "infra_scan: skip — no infrastructure files found.", summary: "0 infra files" };
  }

  for (const file of infraFiles) {
    let content;
    try { content = readFileSync(file, "utf8"); } catch { continue; }
    const lines = content.split(/\r?\n/);

    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trimStart().startsWith("#")) continue;
      for (const pat of INFRA_PATTERNS) {
        if (pat.re.test(lines[i])) {
          findings.push({
            file: relative(cwd, file).replace(/\\/g, "/"),
            line: i + 1,
            severity: pat.severity,
            label: pat.label,
            msg: pat.msg,
          });
        }
      }
    }
  }

  if (findings.length === 0) {
    return { text: "infra_scan: pass — no infrastructure issues detected.", summary: `${infraFiles.length} infra files scanned, 0 findings` };
  }

  const rows = ["## Infrastructure Scan Results\n"];
  rows.push("| File | Line | Severity | Issue |");
  rows.push("|------|------|----------|-------|");
  for (const f of findings) {
    rows.push(`| ${f.file} | ${f.line} | ${f.severity} | ${f.msg} |`);
  }

  const highCount = findings.filter(f => f.severity === "high").length;
  const verdict = highCount > 0 ? `fail — ${highCount} infrastructure violation(s)` : `warn — ${findings.length} issue(s)`;
  rows.push(`\n**Verdict**: ${verdict}`);

  return {
    text: rows.join("\n"),
    summary: `${infraFiles.length} infra files, ${findings.length} findings (${highCount} high)`,
    json: { total: findings.length, high: highCount, findings },
  };
}

// ═══ Tool: observability_check ══════════════════════════════════════════

const OBS_PATTERNS = [
  { re: /catch\s*\(\s*\w*\s*\)\s*\{\s*\}/m, label: "empty-catch", severity: "high", msg: "Empty catch block — error silently swallowed" },
  { re: /catch\s*\{[\s\n]*\}/m, label: "empty-catch", severity: "high", msg: "Empty catch block — error silently swallowed" },
  { re: /catch\s*\(\s*\w+\s*\)\s*\{[\s\n]*\/\//m, label: "comment-only-catch", severity: "medium", msg: "Catch block with only comments — no error handling" },
  { re: /console\.(log|info|debug)\s*\(/m, label: "console-log", severity: "low", msg: "console.log in source — use structured logger" },
  { re: /catch\s*\([^)]*\)\s*\{[^}]*console\.error/m, label: "console-error-only", severity: "medium", msg: "catch uses console.error — no structured error reporting" },
  { re: /process\.exit\s*\(\s*[^0)]/m, label: "hard-exit", severity: "medium", msg: "process.exit with error code — may skip cleanup" },
  { re: /throw\s+new\s+Error\s*\(\s*\)/m, label: "empty-error", severity: "medium", msg: "throw new Error() with no message" }, // scan-ignore: msg contains pattern text, triggers self-referential match
];

/**
 * Check for observability gaps: empty catch blocks, missing error logging,
 * console.log in production code, missing metrics/tracing.
 */
export function toolObservabilityCheck(params) {
  return runPatternScan({
    targetPath: params.path,
    extensions: _langRegistry?.extensionsForDomain("observability") ?? new Set([".ts", ".tsx", ".js", ".jsx", ".mjs"]),
    patterns: _gatherDomainPatterns("observability", OBS_PATTERNS),
    toolName: "observability_check",
    heading: "Observability Check Results",
    passMsg: "no observability gaps detected",
    failNoun: "observability gap(s)",
  });
}

// ═══ Tool: doc_coverage ═════════════════════════════════════════════════

const _LEGACY_EXPORT_RE = /^export\s+(?:async\s+)?(?:function|class|const|let|type|interface|enum)\s+(\w+)/;
const _LEGACY_JSDOC_START = /\/\*\*/;
const EXPORT_RE = _LEGACY_EXPORT_RE;
const JSDOC_START = _LEGACY_JSDOC_START;

/**
 * Check documentation coverage: exported symbols without JSDoc,
 * README staleness, missing API docs for public modules.
 */
export function toolDocCoverage(params) {
  const { path: targetPath } = params;
  const cwd = process.cwd();
  const target = resolve(targetPath || cwd);
  const stat_ = statSync(target, { throwIfNoEntry: false });
  if (!stat_) return { error: `Not found: ${target}` };

  const extSet = _langRegistry?.allExtensions() ?? new Set([".ts", ".tsx", ".js", ".mjs"]);
  const files = stat_.isDirectory() ? walkDir(target, extSet, 5) : [target];

  const findings = [];
  let totalExports = 0;
  let documentedExports = 0;

  for (const file of files) {
    let content;
    try { content = readFileSync(file, "utf8"); } catch { continue; }
    const lines = content.split(/\r?\n/);

    // Use language-specific doc patterns when available
    const spec = _langRegistry?.forFile(file);
    const exportRe = spec?.docPatterns?.exportRe ?? _LEGACY_EXPORT_RE;
    const docStartRe = spec?.docPatterns?.docStartRe ?? _LEGACY_JSDOC_START;

    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(exportRe);
      if (!m) continue;

      totalExports++;

      // Check if previous non-empty line is end of doc comment
      let hasDoc = false;
      for (let j = i - 1; j >= Math.max(0, i - 15); j--) {
        const trimmed = lines[j].trim();
        if (trimmed === "") continue;
        if (trimmed === "*/" || trimmed.endsWith("*/")) { hasDoc = true; break; }
        if (trimmed.startsWith("*") || docStartRe.test(trimmed)) { hasDoc = true; break; }
        // Python: """ docstring check
        if (trimmed.endsWith('"""') || trimmed.endsWith("'''")) { hasDoc = true; break; }
        break;
      }

      if (hasDoc) {
        documentedExports++;
      } else {
        findings.push({
          file: relative(cwd, file).replace(/\\/g, "/"),
          line: i + 1,
          severity: "medium",
          label: "undocumented-export",
          msg: `Exported "${m[1]}" has no doc comment`,
        });
      }
    }
  }

  const coveragePct = totalExports > 0 ? Math.round((documentedExports / totalExports) * 100) : 100;

  const rows = ["## Documentation Coverage Results\n"];
  rows.push(`- Files scanned: ${files.length}`);
  rows.push(`- Exported symbols: ${totalExports}`);
  rows.push(`- Documented: ${documentedExports} (${coveragePct}%)`);
  rows.push(`- Undocumented: ${findings.length}\n`);

  if (findings.length > 0) {
    rows.push("| File | Line | Symbol |");
    rows.push("|------|------|--------|");
    for (const f of findings.slice(0, 50)) {
      rows.push(`| ${f.file} | ${f.line} | ${f.msg} |`);
    }
    if (findings.length > 50) rows.push(`\n... and ${findings.length - 50} more`);
  }

  const verdict = coveragePct < 50 ? `fail — ${coveragePct}% documentation coverage` : coveragePct < 80 ? `warn — ${coveragePct}% coverage` : `pass — ${coveragePct}% coverage`;
  rows.push(`\n**Verdict**: ${verdict}`);

  return {
    text: rows.join("\n"),
    summary: `${totalExports} exports, ${documentedExports} documented (${coveragePct}%)`,
    json: { totalExports, documentedExports, coverage: coveragePct, findings: findings.slice(0, 50) },
  };
}

// ═══ Tool: blueprint_lint ════════════════════════════════════════════════

/**
 * Check source code against Blueprint naming conventions.
 * Parses naming tables from design/ Blueprint markdown, then scans source files
 * for identifiers that violate the mandated names.
 *
 * @param {{ design_dir?: string, path?: string }} params
 */
export function toolBlueprintLint(params) {
  const cwd = process.cwd();
  const designDir = params.design_dir
    ? resolve(params.design_dir)
    : resolve(cwd, "docs", "design");
  const targetPath = params.path ? resolve(params.path) : cwd;

  // Inline minimal parser (always used — no compiled parser dependency)
  const parseBlueprints = (dir) => {
    const rules = [];
    try {
      const files = _walkMarkdown(dir);
      for (const file of files) {
        const content = readFileSync(file, "utf8");
        rules.push(..._extractNamingRulesInline(content, file));
      }
    } catch { /* ok */ }
    return { rules, sources: [] };
  };

  const { rules, sources } = parseBlueprints(designDir);

  if (rules.length === 0) {
    return {
      text: `## Blueprint Naming Lint\n\nNo naming conventions found in ${designDir}.\nCreate a Blueprint with a "Naming Conventions" table to enforce naming.`,
      summary: "blueprint_lint: no rules found",
      json: { total: 0, violations: 0, findings: [] },
    };
  }

  // Convert rules to patterns for runPatternScan
  const patterns = [];
  for (const rule of rules) {
    if (rule.alternatives && rule.alternatives.length > 0) {
      for (const alt of rule.alternatives) {
        const escaped = alt.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        patterns.push({
          re: new RegExp(`\\b${escaped}\\b`),
          label: `naming-violation:${rule.name}`,
          severity: "high",
          msg: `Should be "${rule.name}" per Blueprint (concept: "${rule.concept}"). ${rule.rationale}`,
        });
      }
    }
  }

  if (patterns.length === 0) {
    return {
      text: `## Blueprint Naming Lint\n\n${rules.length} naming rules found, but no violation patterns generated.\nRules: ${rules.map(r => `${r.concept} → ${r.name}`).join(", ")}`,
      summary: `blueprint_lint: ${rules.length} rules, 0 patterns`,
      json: { total: rules.length, violations: 0, findings: [] },
    };
  }

  const result = runPatternScan({
    targetPath,
    extensions: _langRegistry?.extensionsForDomain("perf") ?? new Set([".ts", ".tsx", ".js", ".jsx", ".mjs"]),
    patterns,
    toolName: "blueprint_lint",
    heading: "Blueprint Naming Violations",
    passMsg: `all identifiers follow Blueprint naming conventions (${rules.length} rules)`,
    failNoun: "naming violation(s)",
  });

  // Add rules summary to output
  const rulesSummary = rules.map(r => `| ${r.concept} | \`${r.name}\` | ${r.rationale} |`).join("\n");
  result.text = `## Active Naming Rules\n\n| Concept | Mandated Name | Rationale |\n|---------|--------------|-----------||\n${rulesSummary}\n\n${result.text}`;

  return result;
}

// Inline helpers for fail-open mode (when blueprint-parser.ts is unavailable)
function _walkMarkdown(dir, depth = 0) {
  if (depth > 3 || !existsSync(dir)) return [];
  const results = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) results.push(..._walkMarkdown(full, depth + 1));
    else if (entry.name.endsWith(".md")) results.push(full);
  }
  return results;
}

function _extractNamingRulesInline(content, source) {
  const rules = [];
  const sections = content.split(/^#+\s+/m);
  for (const section of sections) {
    if (!/naming\s+convention/i.test(section.split("\n")[0] || "")) continue;
    let headerFound = false;
    for (const line of section.split("\n")) {
      if (/^\s*\|.*Concept.*Name.*\|/i.test(line)) { headerFound = true; continue; }
      if (/^\s*\|[\s\-:|]+\|/.test(line)) continue;
      if (headerFound && /^\s*\|/.test(line)) {
        const cells = line.split("|").map(c => c.trim()).filter(Boolean);
        if (cells.length >= 2) {
          const concept = cells[0];
          const name = cells[1].replace(/`/g, "");
          const rationale = cells[2] || "";
          const alternatives = _genAlts(concept, name);
          rules.push({ concept, name, rationale, source, alternatives });
        }
      }
    }
  }
  return rules;
}

function _genAlts(concept, name) {
  const alts = [];
  const words = concept.split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    const pascal = words.map(w => w[0].toUpperCase() + w.slice(1).toLowerCase()).join("");
    if (pascal !== name) alts.push(pascal);
    const camel = words[0].toLowerCase() + words.slice(1).map(w => w[0].toUpperCase() + w.slice(1).toLowerCase()).join("");
    if (camel !== name) alts.push(camel);
    for (const suffix of ["List", "Array", "Collection", "Manager", "Service", "Set", "Map", "Handler", "Controller"]) {
      const alt = words[0][0].toUpperCase() + words[0].slice(1) + suffix;
      if (alt !== name) alts.push(alt);
    }
  }
  return [...new Set(alts)].filter(a => a.length > 2);
}


// ═══ Tool: contract_drift ═════════════════════════════════════════════════

/**
 * Detect contract drift: type/interface re-declarations, signature mismatches,
 * and missing members between contract directories and implementations.
 *
 * Uses AST program mode (TypeScript Compiler API) for cross-file analysis.
 * Contract directories: paths containing /types/, /contracts/, /interfaces/
 * (or custom via contract_dirs parameter).
 */
export async function toolContractDrift(params) {
  const cwd = process.cwd();
  if (params.path) { const c = safePathOrError(params.path); if (c.error) return c; }
  const targetPath = params.path ? resolve(params.path) : cwd;

  // Find tsconfig.json
  let tsconfigPath = params.tsconfig;
  if (!tsconfigPath) {
    const candidates = [
      resolve(targetPath, "tsconfig.json"),
      resolve(cwd, "tsconfig.json"),
    ];
    tsconfigPath = candidates.find(c => existsSync(c));
  }

  if (!tsconfigPath || !existsSync(tsconfigPath)) {
    return { error: "tsconfig.json not found. contract_drift requires TypeScript program mode." };
  }

  // Load AST analyzer (program mode)
  let ASTAnalyzer;
  try {
    const astPath = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "dist", "providers", "ast-analyzer.js");
    const mod = await import(astPath);
    ASTAnalyzer = mod.ASTAnalyzer;
  } catch {
    try {
      // Fallback: try direct import
      const mod = await import("../../../dist/providers/ast-analyzer.js");
      ASTAnalyzer = mod.ASTAnalyzer;
    } catch {
      return { error: "AST analyzer unavailable. Run: npm run build" };
    }
  }

  const analyzer = new ASTAnalyzer({ mode: "program" });
  if (!analyzer.initProgram(tsconfigPath)) {
    return { error: `Failed to initialize TypeScript program from ${tsconfigPath}` };
  }

  const contractDirs = params.contract_dirs
    ? params.contract_dirs.split(",").map(d => d.trim())
    : undefined;

  const drifts = analyzer.detectContractDrift(contractDirs);

  if (drifts.length === 0) {
    return {
      text: "## Contract Drift\n\n**0 issues** — all implementations match their contract definitions.",
      summary: "contract_drift: 0 issues (clean)",
      json: { total: 0, findings: [] },
    };
  }

  // Format findings table
  const criticalCount = drifts.filter(d => d.severity === "critical").length;
  const highCount = drifts.filter(d => d.severity === "high").length;

  const rows = drifts.map(d => {
    const relContract = relative(cwd, d.contractFile);
    const relViolation = relative(cwd, d.violationFile);
    return `| \`${d.contractName}\` | ${d.kind} | ${relViolation}:${d.violationLine} | ${d.severity} | ${d.detail} |`;
  });

  const text = [
    "## Contract Drift",
    "",
    `**${drifts.length} issue(s)** found — ${criticalCount} critical, ${highCount} high`,
    "",
    "| Contract | Kind | Violation | Severity | Detail |",
    "|----------|------|-----------|----------|--------|",
    ...rows,
    "",
    "### Resolution",
    "",
    "- **redeclaration**: Delete the duplicate and import from the contract file instead",
    "- **signature-mismatch**: Update implementation to match the contract signature",
    "- **missing-member**: Implement the missing member as defined in the contract",
  ].join("\n");

  return {
    text,
    summary: `contract_drift: ${drifts.length} issue(s) (${criticalCount} critical)`,
    json: { total: drifts.length, critical: criticalCount, high: highCount, findings: drifts },
  };
}


// ═══ Tool: ai_guide ══════════════════════════════════════════════════════

export function toolAiGuide(params) {
  const target = params.target ?? params.path;
  if (!target) return { error: "target is required" };

  const pathCheck = safePathOrError(target);
  if (pathCheck.error) return pathCheck;
  const targetDir = pathCheck.path;
  const stat_ = statSync(targetDir, { throwIfNoEntry: false });
  if (!stat_ || !stat_.isDirectory()) {
    // Graceful fallback for non-existent or non-directory paths
    const name = targetDir.split(/[\\/]/).pop() || "unknown";
    return {
      text: `# AI-GUIDE: ${name}\n\n_Target directory not found or not a directory: ${targetDir}_\n`,
      summary: `ai_guide: target not found — ${targetDir}`,
    };
  }

  // ── Resolve project name from package.json ──
  let projectName = targetDir.split(/[\\/]/).pop() || "project";
  let scripts = {};
  try {
    const pkgPath = resolve(targetDir, "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    if (pkg.name) projectName = pkg.name;
    if (pkg.scripts) scripts = pkg.scripts;
  } catch { /* no package.json or invalid — skip */ }

  // ── Gather tool outputs ──
  const codeMapResult = toolCodeMap({ path: target, depth: 3 });
  const depGraphResult = toolDependencyGraph({ path: target });
  const docCovResult = toolDocCoverage({ path: target });

  // ── Synthesize: Architecture Overview (from dependency_graph) ──
  const archLines = [];
  if (depGraphResult.error) {
    archLines.push("_Could not build dependency graph._");
  } else {
    const dj = depGraphResult.json || {};
    archLines.push(`- **${dj.files || 0}** source files with **${dj.edges || 0}** import edges`);
    archLines.push(`- **${dj.components || 0}** connected components (independent module groups)`);
    if (dj.cycles > 0) {
      archLines.push(`- **Warning**: ${dj.cycles} files involved in circular dependencies`);
    } else {
      archLines.push(`- No circular dependencies detected`);
    }
  }

  // ── Shared file list for key modules + entry points (single walkDir call) ──
  const guideExtSet = _langRegistry?.allExtensions() ?? new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".mts"]);
  const guideFiles = codeMapResult.error ? [] : walkDir(targetDir, guideExtSet, 3);

  // ── Synthesize: Key Modules (from code_map — files with most exports) ──
  const keyModuleLines = [];
  if (codeMapResult.error) {
    keyModuleLines.push("_Could not generate code map._");
  } else {
    const files = guideFiles;
    const cwd = process.cwd();

    // Collect per-file export counts
    const fileCounts = [];
    for (const file of files) {
      const symbols = parseFile(file, null);
      const exportCount = symbols.filter(s => s.type !== "import" && s.type !== "method").length;
      if (exportCount > 0) {
        fileCounts.push({
          rel: relative(cwd, file).replace(/\\/g, "/"),
          count: exportCount,
          types: symbols.map(s => s.type),
        });
      }
    }

    // Sort by export count descending, take top 15
    fileCounts.sort((a, b) => b.count - a.count);
    const topFiles = fileCounts.slice(0, 15);

    // Group by directory
    const byDir = new Map();
    for (const f of topFiles) {
      const dir = f.rel.includes("/") ? f.rel.slice(0, f.rel.lastIndexOf("/")) : ".";
      if (!byDir.has(dir)) byDir.set(dir, []);
      byDir.get(dir).push(f);
    }

    for (const [dir, items] of byDir) {
      keyModuleLines.push(`### ${dir}/`);
      for (const item of items) {
        const fileName = item.rel.includes("/") ? item.rel.slice(item.rel.lastIndexOf("/") + 1) : item.rel;
        keyModuleLines.push(`- \`${fileName}\` — ${item.count} symbols`);
      }
      keyModuleLines.push("");
    }

    if (keyModuleLines.length === 0) {
      keyModuleLines.push("_No exported symbols found._");
    }
  }

  // ── Synthesize: Entry Points (index/main/cli/app files) ──
  const entryLines = [];
  if (!codeMapResult.error) {
    const files = guideFiles;
    const cwd = process.cwd();
    const entryPattern = /(?:^|[\\/])(?:index|main|cli|app)\.[^.]+$/;

    const entryFiles = files.filter(f => entryPattern.test(f)).sort();
    for (const file of entryFiles) {
      const rel = relative(cwd, file).replace(/\\/g, "/");
      const symbols = parseFile(file, null);
      const exported = symbols
        .filter(s => s.type !== "import" && s.type !== "method")
        .map(s => s.name)
        .filter(Boolean)
        .slice(0, 5);
      if (exported.length > 0) {
        entryLines.push(`- \`${rel}\` — exports: ${exported.join(", ")}`);
      } else {
        entryLines.push(`- \`${rel}\``);
      }
    }

    if (entryLines.length === 0) {
      entryLines.push("_No standard entry points (index/main/cli/app) found._");
    }
  } else {
    entryLines.push("_Could not determine entry points._");
  }

  // ── Synthesize: Documentation Gaps (from doc_coverage) ──
  const docGapLines = [];
  if (docCovResult.error) {
    docGapLines.push("_Could not compute documentation coverage._");
  } else {
    const dj = docCovResult.json || {};
    docGapLines.push(`- Overall coverage: **${dj.coverage ?? 0}%** (${dj.documentedExports ?? 0}/${dj.totalExports ?? 0} exports documented)`);

    if (dj.findings && dj.findings.length > 0) {
      // Group by file and show files with most gaps
      const byFile = new Map();
      for (const f of dj.findings) {
        const key = f.file;
        if (!byFile.has(key)) byFile.set(key, 0);
        byFile.set(key, byFile.get(key) + 1);
      }
      const sorted = [...byFile.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
      docGapLines.push("");
      docGapLines.push("Files with most undocumented exports:");
      for (const [file, count] of sorted) {
        docGapLines.push(`- \`${file}\` — ${count} undocumented`);
      }
    }
  }

  // ── Synthesize: Quick Commands (from package.json scripts) ──
  const cmdLines = [];
  const scriptEntries = Object.entries(scripts);
  if (scriptEntries.length > 0) {
    cmdLines.push("```bash");
    for (const [name, cmd] of scriptEntries.slice(0, 15)) {
      const padded = name.length < 20 ? name.padEnd(20) : name;
      cmdLines.push(`npm run ${padded} # ${cmd}`);
    }
    cmdLines.push("```");
  } else {
    cmdLines.push("_No scripts found in package.json._");
  }

  // ── Assemble final guide ──
  const sections = [
    `# AI-GUIDE: ${projectName}`,
    "",
    "## Architecture Overview",
    ...archLines,
    "",
    "## Key Modules",
    ...keyModuleLines,
    "## Entry Points",
    ...entryLines,
    "",
    "## Documentation Gaps",
    ...docGapLines,
    "",
    "## Quick Commands",
    ...cmdLines,
  ];

  const text = sections.join("\n");
  const json = {
    projectName,
    architecture: depGraphResult.json || null,
    docCoverage: docCovResult.json || null,
    scriptCount: scriptEntries.length,
  };
  const summary = `ai_guide: ${projectName} — ${depGraphResult.json?.files ?? 0} files, ${depGraphResult.json?.components ?? 0} components, ${docCovResult.json?.coverage ?? "?"}% doc coverage`;

  return { text, summary, json };
}

// ═══ Re-exports ═════════════════════════════════════════════════════════

export { generateFvm, runFvmValidation };

// ═══ Tool name registry ═════════════════════════════════════════════════

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

// ═══ Tool: agent_comm ═══════════════════════════════════════════════════════

// Lazy bridge import for agent communication
let _commBridge = null;
async function _getCommBridge() {
  if (_commBridge) return _commBridge;
  try {
    _commBridge = await import("../bridge.mjs");
    if (!_commBridge._store) await _commBridge.init(process.cwd());
    return _commBridge;
  } catch { return null; }
}

export async function toolAgentComm(params) {
  const { action, agent_id, to_agent, question, query_id, answer, confidence, context, track_id } = params;

  if (!action) return { error: "action is required: post, respond, poll, responses, roster" };
  if (!agent_id) return { error: "agent_id is required" };

  const bridge = await _getCommBridge();
  if (!bridge) return { error: "Bridge unavailable — agent_comm requires initialized event store" };

  switch (action) {
    case "post": {
      if (!question) return { error: "question is required for post action" };
      const qid = bridge.postAgentQuery(agent_id, question, to_agent || undefined, context);
      if (!qid) return { error: "Failed to post query" };
      return { text: `Query posted: ${qid}${to_agent ? ` → ${to_agent}` : " (broadcast)"}`, json: { queryId: qid } };
    }
    case "respond": {
      if (!query_id || !answer) return { error: "query_id and answer are required for respond action" };
      bridge.respondToAgentQuery(query_id, agent_id, answer, confidence);
      return { text: `Response posted to ${query_id}`, json: { queryId: query_id, status: "responded" } };
    }
    case "poll": {
      const queries = bridge.pollAgentQueries(agent_id, 0);
      if (queries.length === 0) return { text: "No pending queries.", json: { queries: [] } };
      const lines = queries.map(q => `[${q.queryId}] from ${q.fromAgent}: ${q.question}`);
      return { text: lines.join("\n"), json: { queries }, summary: `${queries.length} pending query(ies)` };
    }
    case "responses": {
      if (!query_id) return { error: "query_id is required for responses action" };
      const responses = bridge.getQueryResponses(query_id);
      if (responses.length === 0) return { text: `No responses yet for ${query_id}`, json: { responses: [] } };
      const lines = responses.map(r => `[${r.fromAgent}] (confidence: ${r.confidence ?? "N/A"}): ${r.answer}`);
      return { text: lines.join("\n"), json: { responses }, summary: `${responses.length} response(s)` };
    }
    case "roster": {
      const roster = bridge.getAgentRoster(track_id);
      if (!roster) return { text: "No active agent roster.", json: { agents: [] } };
      return { text: JSON.stringify(roster, null, 2), json: roster };
    }
    default:
      return { error: `Unknown action: ${action}. Use: post, respond, poll, responses, roster` };
  }
}

// ═══ Tool: audit_submit ═══════════════════════════════════════════════

/**
 * Submit evidence for audit — stores in SQLite and evaluates trigger.
 * Stores evidence in SQLite EventStore, evaluates trigger, runs audit if needed.
 */
export async function toolAuditSubmit(params) {
  const { evidence, changed_files, source = "claude-code" } = params;
  if (!evidence) return { error: "evidence is required (markdown text with ### Claim, ### Changed Files, etc.)" };

  const repoRoot = process.cwd();
  const bridgePath = resolve(dirname(fileURLToPath(import.meta.url)), "..", "bridge.mjs");

  let bridge;
  try {
    bridge = await import(pathToFileURL(bridgePath).href);
    await bridge.init(repoRoot);
  } catch (err) {
    return { error: `Bridge init failed: ${err.message}` };
  }

  // Extract changed files from evidence if not provided
  const changedFiles = changed_files ?? [];
  if (changedFiles.length === 0) {
    const section = evidence.match(/###\s*Changed Files[\s\S]*?(?=###|$)/i);
    if (section) {
      const filePattern = /^[\s-]*`([^`]+)`/gm;
      let m;
      while ((m = filePattern.exec(section[0])) !== null) changedFiles.push(m[1]);
    }
  }

  // Store evidence in SQLite
  bridge.emitEvent("evidence.write", source, {
    content: evidence,
    changedFiles,
    triggerTag: "[REVIEW_NEEDED]",
  });
  bridge.setState("evidence:latest", {
    content: evidence,
    changedFiles,
    timestamp: Date.now(),
  });

  // Evaluate trigger via bridge public API
  const ctx = {
    changedFiles: changedFiles.length,
    securitySensitive: changedFiles.some(f => /auth|secret|key|cred|token|password/i.test(f)),
    priorRejections: 0,
    apiSurfaceChanged: false,
    crossLayerChange: false,
    isRevert: false,
  };
  const trigger = bridge.evaluateTrigger(ctx);
  if (!trigger) {
    return { text: "Evidence stored in SQLite. Trigger evaluation unavailable." };
  }

  bridge.emitEvent("audit.submit", source, {
    tier: trigger.tier,
    score: trigger.score,
    mode: trigger.mode,
    changedFiles,
  });

  if (trigger.mode === "skip") {
    return { text: `Evidence stored. ${trigger.tier} skip (score: ${trigger.score.toFixed(2)}) — audit not needed.` };
  }

  // Trigger audit
  const auditScript = resolve(dirname(fileURLToPath(import.meta.url)), "..", "audit", "index.mjs");
  if (existsSync(auditScript)) {
    const { spawnSync } = await import("node:child_process");
    const result = spawnSync(process.execPath, [auditScript], {
      stdio: "inherit", cwd: repoRoot, windowsHide: true,
    });
    return { text: `Evidence stored. ${trigger.tier} ${trigger.mode} (score: ${trigger.score.toFixed(2)}). Audit ${result.status === 0 ? "completed" : "failed"}.` };
  }

  return { text: `Evidence stored. ${trigger.tier} ${trigger.mode} (score: ${trigger.score.toFixed(2)}). Audit module not found.` };
}

// ═══ skill_sync — Canonical → Adapter wrapper synchronization ═══════════

/**
 * Adapter wrapper templates — tool name mapping per adapter.
 */
const ADAPTER_CONFIGS = {
  "claude-code": {
    namePrefix: "quorum:",
    model: "claude-sonnet-4-6",
    title: "Claude Code",
    tools: { read: "Read", write: "Write", edit: "Edit", glob: "Glob", grep: "Grep", bash: "Bash" },
    allowedTools: (canonical) => {
      const ops = canonical.tools || ["read", "glob", "grep"];
      const parts = [];
      for (const op of ops) {
        if (op === "bash") { parts.push("Bash(node *)", "Bash(quorum *)"); }
        else { parts.push(ADAPTER_CONFIGS["claude-code"].tools[op] || op); }
      }
      return parts.join(", ");
    },
  },
  codex: {
    namePrefix: "quorum-",
    model: "codex",
    title: "Codex",
    tools: { read: "read_file", write: "write_file", edit: "apply_diff", glob: "find_files", grep: "search", bash: "shell" },
    allowedTools: (canonical) => {
      const ops = canonical.tools || ["read", "glob", "grep"];
      return ops.map(op => ADAPTER_CONFIGS.codex.tools[op] || op).join(", ");
    },
  },
  gemini: {
    namePrefix: "quorum-",
    model: "gemini-2.5-pro",
    title: "Gemini",
    tools: { read: "read_file", write: "write_file", edit: "edit_file", glob: "glob", grep: "grep", bash: "run_shell_command" },
    allowedTools: (canonical) => {
      const ops = canonical.tools || ["read", "glob", "grep"];
      return ops.map(op => ADAPTER_CONFIGS.gemini.tools[op] || op).join(", ");
    },
  },
  "openai-compatible": {
    namePrefix: "quorum-",
    model: null,
    title: "OpenAI-Compatible",
    tools: { read: "read", write: "write", edit: "edit", glob: "glob", grep: "grep", bash: "bash" },
    allowedTools: (canonical) => {
      const ops = canonical.tools || ["read", "glob", "grep"];
      return ops.map(op => ADAPTER_CONFIGS["openai-compatible"].tools[op] || op).join(", ");
    },
  },
};

/**
 * Parse YAML frontmatter from a SKILL.md file.
 * @param {string} content
 * @returns {{ name: string, description: string, tools?: string[], [k:string]: any } | null}
 */
function parseSkillFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;
  const yaml = match[1];
  const result = {};
  for (const line of yaml.split("\n")) {
    const kv = line.match(/^(\w[\w-]*)\s*:\s*(.+)/);
    if (kv) {
      let val = kv[2].trim();
      // Strip quotes
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      // Parse array
      if (val.startsWith("[") && val.endsWith("]")) {
        val = val.slice(1, -1).split(",").map(s => s.trim()).filter(Boolean);
      }
      result[kv[1]] = val;
    }
    // Parse YAML list items (  - item)
    const listItem = line.match(/^\s+-\s+(.+)/);
    if (listItem) {
      const lastKey = Object.keys(result).pop();
      if (lastKey && !Array.isArray(result[lastKey])) {
        result[lastKey] = [];
      }
      if (lastKey) result[lastKey].push(listItem[1].trim());
    }
  }
  return result;
}

/**
 * Generate adapter wrapper content from canonical skill metadata.
 */
function generateWrapper(adapterName, canonical, skillName) {
  const cfg = ADAPTER_CONFIGS[adapterName];
  if (!cfg) return null;
  const name = `${cfg.namePrefix}${skillName}`;
  const modelLine = cfg.model ? `\nmodel: ${cfg.model}` : "";
  const argHint = canonical["argument-hint"] ? `\nargument-hint: "${canonical["argument-hint"]}"` : "";
  const allowed = cfg.allowedTools(canonical);

  const toolRows = Object.entries(cfg.tools)
    .filter(([op]) => !canonical.tools || canonical.tools.includes(op))
    .map(([op, native]) => `| ${op.charAt(0).toUpperCase() + op.slice(1)} file | \`${native}\` |`)
    .join("\n");

  // Fix operation labels
  const labelMap = { read: "Read file", write: "Write file", edit: "Edit file", glob: "Find files", grep: "Search content", bash: "Run command" };
  const rows = Object.entries(cfg.tools)
    .filter(([op]) => !canonical.tools || canonical.tools.includes(op))
    .map(([op, native]) => `| ${labelMap[op] || op} | \`${native}\` |`)
    .join("\n");

  return `---
name: ${name}
description: "${(canonical.description || "").replace(/"/g, '\\"')}"${argHint}${modelLine}
allowed-tools: ${allowed}
---

# ${skillName.split("-").map(w => w[0].toUpperCase() + w.slice(1)).join(" ")} (${cfg.title})

## ${cfg.title} Tool Mapping

| Operation | Tool |
|-----------|------|
${rows}

## Start

Read and follow the canonical skill at \`platform/skills/${skillName}/SKILL.md\`.
`;
}

/**
 * skill_sync — Detect and fix mismatches between canonical skills and adapter wrappers.
 *
 * @param {{ mode?: "check"|"fix", path?: string }} params
 * @returns {{ text: string, summary: string, json?: object } | { error: string }}
 */
export function toolSkillSync(params) {
  const { mode = "check" } = params;
  const repoRoot = params.path ? safePath(params.path) : _cwd;
  const skillsDir = resolve(repoRoot, "platform", "skills");
  const adaptersDir = resolve(repoRoot, "platform", "adapters");

  if (!existsSync(skillsDir)) return { error: `platform/skills/ directory not found at ${repoRoot}` };
  if (!existsSync(adaptersDir)) return { error: `platform/adapters/ directory not found at ${repoRoot}` };

  const ADAPTERS = ["claude-code", "codex", "gemini", "openai-compatible"];
  const results = { missing: [], outdated: [], synced: [], created: [], updated: [] };

  // Scan canonical skills
  let skillDirs;
  try { skillDirs = readdirSync(skillsDir, { withFileTypes: true }).filter(d => d.isDirectory()); }
  catch { return { error: `Cannot read platform/skills/ directory` }; }

  for (const dir of skillDirs) {
    const skillName = dir.name;
    const canonPath = resolve(skillsDir, skillName, "SKILL.md");
    if (!existsSync(canonPath)) continue;

    let canonContent;
    try { canonContent = readFileSync(canonPath, "utf8"); } catch { continue; }
    const canonical = parseSkillFrontmatter(canonContent);
    if (!canonical || !canonical.name) continue;

    for (const adapter of ADAPTERS) {
      const wrapperPath = resolve(adaptersDir, adapter, "skills", skillName, "SKILL.md");
      const relWrapper = relative(repoRoot, wrapperPath).replace(/\\/g, "/");

      if (!existsSync(wrapperPath)) {
        results.missing.push({ skill: skillName, adapter, path: relWrapper });
        if (mode === "fix") {
          const content = generateWrapper(adapter, canonical, skillName);
          if (content) {
            mkdirSync(dirname(wrapperPath), { recursive: true });
            _writeFileSync(wrapperPath, content, "utf8");
            results.created.push({ skill: skillName, adapter, path: relWrapper });
          }
        }
        continue;
      }

      // Check description mismatch
      let wrapperContent;
      try { wrapperContent = readFileSync(wrapperPath, "utf8"); } catch { continue; }
      const wrapper = parseSkillFrontmatter(wrapperContent);
      if (!wrapper) continue;

      if (canonical.description && wrapper.description !== canonical.description) {
        results.outdated.push({ skill: skillName, adapter, path: relWrapper, field: "description" });
        if (mode === "fix") {
          const updated = wrapperContent.replace(
            /^description:\s*"[^"]*"/m,
            `description: "${canonical.description.replace(/"/g, '\\"')}"`
          );
          _writeFileSync(wrapperPath, updated, "utf8");
          results.updated.push({ skill: skillName, adapter, path: relWrapper });
        }
      } else {
        results.synced.push({ skill: skillName, adapter });
      }
    }
  }

  // Format output
  const lines = [`# Skill Sync Report`, ``, `Mode: **${mode}**`, ``];

  if (results.missing.length > 0) {
    lines.push(`## Missing Wrappers (${results.missing.length})`, ``);
    lines.push(`| Skill | Adapter | Path |`, `|-------|---------|------|`);
    for (const m of results.missing) lines.push(`| ${m.skill} | ${m.adapter} | \`${m.path}\` |`);
    lines.push(``);
  }

  if (results.outdated.length > 0) {
    lines.push(`## Outdated Wrappers (${results.outdated.length})`, ``);
    lines.push(`| Skill | Adapter | Field |`, `|-------|---------|-------|`);
    for (const o of results.outdated) lines.push(`| ${o.skill} | ${o.adapter} | ${o.field} |`);
    lines.push(``);
  }

  if (mode === "fix" && (results.created.length + results.updated.length) > 0) {
    lines.push(`## Fixed`, ``);
    if (results.created.length > 0) {
      lines.push(`Created: ${results.created.length} wrappers`);
      for (const c of results.created) lines.push(`- \`${c.path}\``);
    }
    if (results.updated.length > 0) {
      lines.push(`Updated: ${results.updated.length} wrappers`);
      for (const u of results.updated) lines.push(`- \`${u.path}\``);
    }
    lines.push(``);
  }

  const total = skillDirs.filter(d => existsSync(resolve(skillsDir, d.name, "SKILL.md"))).length;
  lines.push(`## Summary`, ``);
  lines.push(`- Canonical skills: ${total}`);
  lines.push(`- Synced: ${results.synced.length} / ${total * ADAPTERS.length}`);
  lines.push(`- Missing: ${results.missing.length}`);
  lines.push(`- Outdated: ${results.outdated.length}`);

  const issues = results.missing.length + results.outdated.length;
  const summary = mode === "fix"
    ? `Fixed ${results.created.length} missing + ${results.updated.length} outdated wrappers`
    : `${issues === 0 ? "All synced" : `${issues} issues found`} across ${total} skills × ${ADAPTERS.length} adapters`;

  return { text: lines.join("\n"), summary, json: results };
}


// ═══ track_archive — Archive completed track planning artifacts ══════════

/**
 * track_archive — Move completed track artifacts to archive directory.
 *
 * @param {{ track: string, path?: string, dry_run?: boolean }} params
 * @returns {{ text: string, summary: string, json?: object } | { error: string }}
 */
export function toolTrackArchive(params) {
  const { track, dry_run = false } = params;
  if (!track) return { error: "track name is required" };

  const repoRoot = params.path ? safePath(params.path) : _cwd;
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10); // YYYY-MM-DD
  const archiveDir = resolve(repoRoot, ".claude", "quorum", "archive", dateStr, track);

  // Scan for track artifacts
  const artifacts = [];

  // 1. Planning directory (.claude/quorum/{track}/ or .claude/planning/{track}/)
  const planningDirs = [
    resolve(repoRoot, ".claude", "quorum", track),
    resolve(repoRoot, ".claude", "planning", track),
    resolve(repoRoot, ".claude", track),
  ];

  for (const dir of planningDirs) {
    if (!existsSync(dir)) continue;
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const e of entries) {
        if (e.isFile()) {
          artifacts.push({
            source: resolve(dir, e.name),
            relSource: relative(repoRoot, resolve(dir, e.name)).replace(/\\/g, "/"),
            name: e.name,
            type: classifyArtifact(e.name),
          });
        }
      }
    } catch { /* skip */ }
  }

  // 2. Design docs (design/{track}/ or .claude/quorum/design/{track}/)
  const designDirs = [
    resolve(repoRoot, "design", track),
    resolve(repoRoot, ".claude", "quorum", "design", track),
  ];
  for (const dir of designDirs) {
    if (!existsSync(dir)) continue;
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const e of entries) {
        if (e.isFile()) {
          artifacts.push({
            source: resolve(dir, e.name),
            relSource: relative(repoRoot, resolve(dir, e.name)).replace(/\\/g, "/"),
            name: e.name,
            type: "design",
          });
        }
      }
    } catch { /* skip */ }
  }

  // 3. Wave state
  const waveState = resolve(repoRoot, ".claude", "quorum", `wave-state-${track}.json`);
  if (existsSync(waveState)) {
    artifacts.push({
      source: waveState,
      relSource: relative(repoRoot, waveState).replace(/\\/g, "/"),
      name: `wave-state-${track}.json`,
      type: "state",
    });
  }

  // 4. Handoff file
  const handoff = resolve(repoRoot, ".claude", "quorum", `handoff-${track}.md`);
  if (existsSync(handoff)) {
    artifacts.push({
      source: handoff,
      relSource: relative(repoRoot, handoff).replace(/\\/g, "/"),
      name: `handoff-${track}.md`,
      type: "handoff",
    });
  }

  if (artifacts.length === 0) {
    return { error: `No artifacts found for track "${track}"` };
  }

  // Format report
  const lines = [`# Track Archive: ${track}`, ``];
  lines.push(`Date: ${dateStr}`);
  lines.push(`Archive: \`.claude/quorum/archive/${dateStr}/${track}/\``);
  lines.push(`Mode: ${dry_run ? "dry-run (no changes)" : "archive"}`);
  lines.push(``);

  // Group by type
  const byType = {};
  for (const a of artifacts) {
    (byType[a.type] = byType[a.type] || []).push(a);
  }

  lines.push(`## Artifacts (${artifacts.length})`, ``);
  lines.push(`| Type | File | Source |`);
  lines.push(`|------|------|--------|`);
  for (const a of artifacts) {
    lines.push(`| ${a.type} | ${a.name} | \`${a.relSource}\` |`);
  }
  lines.push(``);

  // Execute archive (move files)
  if (!dry_run) {
    mkdirSync(archiveDir, { recursive: true });
    let moved = 0;
    const errors = [];

    for (const a of artifacts) {
      const dest = resolve(archiveDir, a.name);
      try {
        // Copy first, then delete (cross-device safe)
        copyFileSync(a.source, dest);
        unlinkSync(a.source);
        moved++;
      } catch (e) {
        errors.push(`${a.name}: ${e.message}`);
      }
    }

    lines.push(`## Result`, ``);
    lines.push(`Archived: ${moved} / ${artifacts.length} files`);
    if (errors.length > 0) {
      lines.push(`Errors: ${errors.length}`);
      for (const e of errors) lines.push(`- ${e}`);
    }

    // Write summary manifest
    const manifest = {
      track,
      date: dateStr,
      artifacts: artifacts.map(a => ({ name: a.name, type: a.type, source: a.relSource })),
      archivedAt: now.toISOString(),
    };
    _writeFileSync(resolve(archiveDir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
  }

  const summary = dry_run
    ? `${artifacts.length} artifacts found for "${track}" (dry-run)`
    : `Archived ${artifacts.length} artifacts for "${track}" to .claude/quorum/archive/${dateStr}/${track}/`;

  return { text: lines.join("\n"), summary, json: { track, date: dateStr, count: artifacts.length, artifacts } };
}

/**
 * Classify artifact by filename.
 */
function classifyArtifact(name) {
  const lower = name.toLowerCase();
  if (lower.includes("prd")) return "PRD";
  if (lower.includes("drm")) return "DRM";
  if (lower.includes("work-breakdown") || lower.includes("wb")) return "WB";
  if (lower.includes("rtm")) return "RTM";
  if (lower.includes("design") || lower.includes("spec") || lower.includes("blueprint")) return "design";
  if (lower.includes("handoff")) return "handoff";
  if (lower.includes("wave-state")) return "state";
  if (lower.includes("cps")) return "CPS";
  return "artifact";
}
