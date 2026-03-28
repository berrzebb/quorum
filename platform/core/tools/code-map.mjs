#!/usr/bin/env node
/**
 * code-map.mjs — Zero-token codebase scout for implementer agents.
 *
 * Outputs a compact symbol index: `path:L{n} type name`
 * so agents can Read(offset, limit) the exact range they need.
 *
 * Usage:
 *   node code-map.mjs <path>                       # directory or file
 *   node code-map.mjs <path> --filter fn            # functions only
 *   node code-map.mjs <path> --filter fn,class       # functions + classes
 *   node code-map.mjs <path> --depth 2              # max directory depth
 *   node code-map.mjs <path> --ext .ts,.mjs          # file extensions
 *   node code-map.mjs <path> --ranges               # include end lines (L10-L25)
 *
 * Output format:
 *   src/bus/redis.ts:L45 fn createClient(opts)
 *   src/bus/redis.ts:L78-L92 fn disconnect()         (with --ranges)
 *   src/agent/index.ts:L12 class AgentRunner
 *   src/agent/index.ts:L5 import { Router } from "express"
 */
import { statSync } from "node:fs";
import { resolve, relative } from "node:path";
import { parseFile as _parseFile, findEndLine, walkDir } from "./tool-core.mjs";

// Try to load language registry for default extensions
let _defaultExt = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".mts"]);
try {
  const { loadAll } = await import("../languages/registry.mjs");
  const reg = await loadAll();
  if (reg.size > 0) _defaultExt = reg.allExtensions();
} catch { /* fallback to legacy extensions */ }

const DEFAULTS = {
  extensions: _defaultExt,
  maxDepth: 10,
  filters: null, // null = all types
  showRanges: false,
};

// Wrap parseFile to add --ranges support (loc field) on top of tool-core's base output
function parseFileWithRanges(filePath, filters, showRanges) {
  const symbols = _parseFile(filePath, filters);
  return symbols.map(s => {
    let loc = `L${s.line}`;
    if (showRanges && ["fn", "method", "class", "iface", "enum"].includes(s.type)) {
      if (s.endLine > s.line) loc = `L${s.line}-L${s.endLine}`;
    }
    return { ...s, loc };
  });
}

// ── Main ────────────────────────────────────────────────────
function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes("--help")) {
    console.log("Usage: node code-map.mjs <path> [--filter fn,class] [--depth N] [--ext .ts,.mjs] [--ranges]");
    console.log("\nTypes: fn, method, class, iface, type, enum, import, export");
    process.exit(0);
  }

  const target = resolve(args[0]);
  const opts = { ...DEFAULTS };

  for (let i = 1; i < args.length; i++) {
    if (args[i] === "--filter" && args[i + 1]) {
      opts.filters = new Set(args[++i].split(","));
    } else if (args[i] === "--depth" && args[i + 1]) {
      opts.maxDepth = parseInt(args[++i], 10);
    } else if (args[i] === "--ext" && args[i + 1]) {
      opts.extensions = new Set(args[++i].split(","));
    } else if (args[i] === "--ranges") {
      opts.showRanges = true;
    }
  }

  const stat = statSync(target, { throwIfNoEntry: false });
  if (!stat) { console.error(`Not found: ${target}`); process.exit(1); }

  const files = stat.isDirectory()
    ? walkDir(target, opts.extensions, opts.maxDepth)
    : [target];

  const cwd = process.cwd();
  let totalSymbols = 0;

  for (const file of files.sort()) {
    const symbols = parseFileWithRanges(file, opts.filters, opts.showRanges);
    if (symbols.length === 0) continue;

    const rel = relative(cwd, file);
    for (const s of symbols) {
      console.log(`${rel}:${s.loc} ${s.type} ${s.name}${s.detail}`);
    }
    totalSymbols += symbols.length;
  }

  console.error(`\n${files.length} files, ${totalSymbols} symbols`);
}

main();
