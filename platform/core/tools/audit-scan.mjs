#!/usr/bin/env node
/**
 * Quick codebase scan — replaces expensive agent grep operations.
 * Usage: node <this-script> [category] [target-path]
 *
 * Categories: type-safety, hardcoded, empty-catch, todo, all
 *
 * Uses Node.js built-in fs (no rg/grep dependency).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve, extname } from "node:path";
import { execSync } from "node:child_process";

function getRepoRoot() {
  try {
    return execSync("git rev-parse --show-toplevel", { encoding: "utf8", windowsHide: true }).trim();
  } catch (err) {
    console.warn("[audit-scan] git rev-parse failed:", err?.message ?? err);
    return process.cwd();
  }
}

const ROOT = getRepoRoot();
const category = process.argv[2] || "all";
const target = process.argv[3] || ".";
const targetPath = resolve(ROOT, target);

const CODE_EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".py", ".go", ".rs", ".java"]);
const IGNORE_DIRS = new Set(["node_modules", ".git", "dist", "build", "__pycache__", ".next", "coverage", ".claude"]);

function walkFiles(dir, files = []) {
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (IGNORE_DIRS.has(entry.name)) continue;
      const full = resolve(dir, entry.name);
      if (entry.isDirectory()) {
        walkFiles(full, files);
      } else if (CODE_EXTS.has(extname(entry.name))) {
        files.push(full);
      }
    }
  } catch (err) { console.warn("[audit-scan] walkFiles failed:", err?.message ?? err); }
  return files;
}

function scanFile(filePath) {
  try { return readFileSync(filePath, "utf8"); } catch (err) { console.warn("[audit-scan] scanFile read failed:", err?.message ?? err); return ""; }
}

// Resolve target: single file or directory
let files;
try {
  const st = statSync(targetPath);
  files = st.isDirectory() ? walkFiles(targetPath) : CODE_EXTS.has(extname(targetPath)) ? [targetPath] : [];
} catch (err) {
  console.warn("[audit-scan] target stat failed:", err?.message ?? err);
  files = [];
}

const scans = {
  "type-safety": {
    label: "Type Safety Issues (as any, @ts-ignore, @ts-expect-error)",
    pattern: /\bas\s+any\b|@ts-ignore|@ts-expect-error/,
    scanIgnore: true,
  },
  "hardcoded": {
    label: "Hardcoded Values (localhost, ports, Redis URLs)",
    pattern: /localhost|127\.0\.0\.1|redis:\/\/|:6379(?!\d)|:3000(?!\d)/,
  },
  "empty-catch": {
    label: "Empty Catch Blocks",
    pattern: /catch\s*(?:\([^)]*\)\s*)?\{\s*\}/,
  },
  "todo": {
    label: "TODO/FIXME/HACK Comments",
    pattern: /\b(TODO|FIXME|HACK)\b/,
  },
};

const targets = category === "all" ? Object.keys(scans) : [category];

for (const key of targets) {
  const scan = scans[key];
  if (!scan) { console.error(`Unknown category: ${key}`); continue; }
  console.log(`\n=== ${scan.label} ===`);

  const findings = [];
  for (const f of files) {
    const content = scanFile(f);
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!scan.pattern.test(line)) continue;
      // scan-ignore pragma
      if (scan.scanIgnore && line.includes("// scan-ignore")) continue;
      if (line.includes("// scan-ignore")) continue;
      const rel = f.replace(ROOT + "/", "").replace(ROOT + "\\", "");
      findings.push(`  ${rel}:${i + 1}: ${line.trim().slice(0, 120)}`);
    }
  }

  if (findings.length > 0) {
    console.log(findings.join("\n"));
    console.log(`\n  (${findings.length} finding(s))`);
  } else {
    console.log("  (none found)");
  }
}
