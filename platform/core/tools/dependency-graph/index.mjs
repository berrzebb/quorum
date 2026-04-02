/**
 * dependency-graph/index.mjs — Tool: dependency_graph
 *
 * Import/export DAG, components, topological sort, cycles.
 * Extracted from tool-core.mjs (SPLIT-2).
 */
import { readFileSync, existsSync, statSync } from "node:fs";
import { resolve, relative, dirname } from "node:path";
import { _langRegistry, CACHE, CODE_EXT, walkDir, safePathOrError, getCacheKey, getLatestMtime } from "../tool-utils.mjs";

// ═══ Import patterns ════════════════════════════════════════════════════

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
