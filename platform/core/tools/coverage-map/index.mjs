/**
 * coverage-map/index.mjs — Tool: coverage_map
 *
 * Per-file coverage percentages from vitest JSON.
 * Extracted from tool-core.mjs (SPLIT-2).
 */
import { resolve, relative } from "node:path";
import { statSync } from "node:fs";
import { loadCoverageSummary } from "../coverage-mapper.mjs";
import { safePathOrError } from "../tool-utils.mjs";

// ═══ Tool: coverage_map ═════════════════════════════════════════════════

export function toolCoverageMap(params) {
  const { path: targetPath, coverage_dir: covDir = "coverage" } = params;
  if (targetPath) { const c = safePathOrError(targetPath); if (c.error) return c; }
  // Use targetPath as project root if it's a directory, else cwd
  let projectRoot = process.cwd();
  if (targetPath) {
    const p = resolve(targetPath);
    try { if (statSync(p).isDirectory()) projectRoot = p; } catch (err) { console.warn(`[tool-core] coverage_map: target path ${targetPath} not found, using cwd:`, err.message); }
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
