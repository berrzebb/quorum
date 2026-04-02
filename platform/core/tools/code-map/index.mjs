/**
 * code-map/index.mjs — Tool: code_map
 *
 * Zero-token symbol index with caching + matrix output.
 * Extracted from tool-core.mjs (SPLIT-2).
 */
import { readFileSync } from "node:fs";
import { statSync } from "node:fs";
import { relative } from "node:path";
import { safePathOrError, getCacheKey, getLatestMtime, CACHE, CODE_EXT, walkDir, parseFile } from "../tool-utils.mjs";

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
    } catch (err) { console.warn("[tool-core] operation failed:", err?.message ?? err); }

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
