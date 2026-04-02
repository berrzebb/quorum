/**
 * perf-scan/index.mjs — Tool: perf_scan
 *
 * Scan for performance anti-patterns: O(n^2) loops, sync I/O in hot paths,
 * missing pagination, unbounded queries, large bundle imports.
 * Extracted from tool-core.mjs (SPLIT-2).
 */
import { runPatternScan, _gatherDomainPatterns, _createAstRefine, _langRegistry } from "../tool-utils.mjs";

// ═══ Performance patterns ═══════════════════════════════════════════════

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

// ═══ Tool: perf_scan ════════════════════════════════════════════════════

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
