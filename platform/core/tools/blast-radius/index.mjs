/**
 * blast-radius/index.mjs — Tool: blast_radius
 *
 * BFS on reverse import graph → transitive dependents of changed files.
 * Extracted from tool-core.mjs (SPLIT-2).
 */
import { resolve, relative } from "node:path";
import { statSync } from "node:fs";
import { buildRawGraph } from "../dependency-graph/index.mjs";
import { safePathOrError, getCacheKey, getLatestMtime, CACHE } from "../tool-utils.mjs";

// ═══ Blast radius computation ═══════════════════════════════════════════

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
