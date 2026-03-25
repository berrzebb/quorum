/**
 * Unwired Implementation Scanner (UW)
 *
 * Detects exported symbols that are never imported anywhere in the project.
 * These represent "implemented but not wired" code — the #1 semantic defect
 * pattern found in the Tetris test project.
 *
 * Two result types:
 * - UW-definite: zero static consumers found (blocking)
 * - UW-suspected: only dynamic/indirect references (warning, forwarded to Devil's Advocate)
 *
 * 3-party consensus: User + Codex + Claude (2026-03-21)
 */

import { execFileSync } from "node:child_process";
import { resolve, relative, extname } from "node:path";
import { existsSync, readFileSync, readdirSync } from "node:fs";

/**
 * @param {string} targetPath - Directory to scan
 * @param {object} options - { changedFiles?: string[], entryPoints?: string[] }
 * @returns {{ findings: UWFinding[], summary: { definite: number, suspected: number } }}
 */
export function unwiredScan(targetPath, options = {}) {
  // Read all source files once, share content across all collectors
  const sourceFiles = collectSourceFiles(targetPath);
  const contentMap = new Map();
  for (const file of sourceFiles) {
    try { contentMap.set(file, readFileSync(file, "utf8")); } catch { /* skip */ }
  }

  const exports = collectExports(targetPath, contentMap);
  const imports = collectImports(targetPath, contentMap);
  const dynamicPatterns = collectDynamicPatterns(targetPath, contentMap);
  const changedFiles = new Set((options.changedFiles ?? []).map(f => resolve(targetPath, f)));

  const findings = [];

  for (const [symbol, exportInfo] of exports) {
    const filePath = exportInfo.file;

    // Skip if not in changed files (when changedFiles filter is provided)
    if (changedFiles.size > 0 && !changedFiles.has(resolve(targetPath, filePath))) continue;

    // Skip test files
    if (isTestFile(filePath)) continue;

    // Skip __init__ / index re-exports
    if (isReExportFile(filePath)) continue;

    // Check static imports
    const consumers = imports.get(symbol) ?? [];
    const hasStaticConsumer = consumers.length > 0;

    // Check dynamic patterns
    const hasDynamicRef = dynamicPatterns.some(p =>
      p.content.includes(symbol) && p.file !== filePath
    );

    if (!hasStaticConsumer && !hasDynamicRef) {
      findings.push({
        symbol,
        file: filePath,
        line: exportInfo.line,
        status: "definite",
        reason: "exported but no static consumer found in project",
        confidence: "deterministic",
        suggestedAction: `wire to runtime path OR mark as intentionally unused`,
      });
    } else if (!hasStaticConsumer && hasDynamicRef) {
      findings.push({
        symbol,
        file: filePath,
        line: exportInfo.line,
        status: "suspected",
        reason: "exported, no static import, but dynamic reference exists",
        confidence: "high",
        suggestedAction: `verify dynamic wiring is intentional`,
      });
    }
  }

  return {
    findings,
    summary: {
      definite: findings.filter(f => f.status === "definite").length,
      suspected: findings.filter(f => f.status === "suspected").length,
    },
  };
}

/**
 * Format UW results for display.
 */
function formatUwResults(result) {
  const lines = [];

  if (result.findings.length === 0) {
    return "✓ No unwired implementations found.";
  }

  const definite = result.findings.filter(f => f.status === "definite");
  const suspected = result.findings.filter(f => f.status === "suspected");

  if (definite.length > 0) {
    lines.push(`🔴 UW-definite (${definite.length}):`);
    for (const f of definite) {
      lines.push(`  ${f.file}:${f.line} — ${f.symbol}`);
      lines.push(`    ${f.reason}`);
      lines.push(`    → ${f.suggestedAction}`);
    }
  }

  if (suspected.length > 0) {
    lines.push(`🟡 UW-suspected (${suspected.length}):`);
    for (const f of suspected) {
      lines.push(`  ${f.file}:${f.line} — ${f.symbol}`);
      lines.push(`    ${f.reason}`);
    }
  }

  lines.push(`\nTotal: ${definite.length} definite, ${suspected.length} suspected`);
  return lines.join("\n");
}

// ── Export collector ──────────────────────────

function collectExports(targetPath, contentMap) {
  const exports = new Map(); // symbol → { file, line }

  for (const [file, content] of contentMap) {
    const relPath = relative(targetPath, file);
    const ext = extname(file);

    if ([".ts", ".js", ".mjs", ".tsx", ".jsx"].includes(ext)) {
      // ES export: export function/class/const/type
      const exportRe = /^export\s+(?:default\s+)?(?:function|class|const|let|var|type|interface|enum)\s+(\w+)/gm;
      let match;
      while ((match = exportRe.exec(content)) !== null) {
        const line = content.substring(0, match.index).split("\n").length;
        exports.set(match[1], { file: relPath, line });
      }

      // Named re-export: export { X } from
      const reExportRe = /export\s*\{([^}]+)\}/g;
      while ((match = reExportRe.exec(content)) !== null) {
        const names = match[1].split(",").map(n => n.trim().split(/\s+as\s+/).pop().trim());
        const line = content.substring(0, match.index).split("\n").length;
        for (const name of names) {
          if (name && !exports.has(name)) {
            exports.set(name, { file: relPath, line });
          }
        }
      }
    }

    if (ext === ".py") {
      // Python: class/def at module level
      const pyExportRe = /^(?:class|def)\s+(\w+)/gm;
      let match;
      while ((match = pyExportRe.exec(content)) !== null) {
        if (match[1].startsWith("_")) continue; // skip private
        const line = content.substring(0, match.index).split("\n").length;
        exports.set(match[1], { file: relPath, line });
      }
    }
  }

  return exports;
}

// ── Import collector ─────────────────────────

function collectImports(targetPath, contentMap) {
  const imports = new Map(); // symbol → [consumer files]

  for (const [file, content] of contentMap) {
    const relPath = relative(targetPath, file);
    const ext = extname(file);

    if ([".ts", ".js", ".mjs", ".tsx", ".jsx"].includes(ext)) {
      // import { X, Y } from  AND  import type { X, Y } from
      const importRe = /import\s+(?:type\s+)?\{([^}]+)\}\s*from/g;
      let match;
      while ((match = importRe.exec(content)) !== null) {
        const names = match[1].split(",").map(n => n.trim().split(/\s+as\s+/)[0].trim());
        for (const name of names) {
          if (!imports.has(name)) imports.set(name, []);
          imports.get(name).push(relPath);
        }
      }

      // import X from (default)
      const defaultRe = /import\s+(\w+)\s+from/g;
      while ((match = defaultRe.exec(content)) !== null) {
        const name = match[1];
        if (!imports.has(name)) imports.set(name, []);
        imports.get(name).push(relPath);
      }
    }

    if (ext === ".py") {
      // from module import X, Y
      const pyImportRe = /from\s+\S+\s+import\s+(.+)/g;
      let match;
      while ((match = pyImportRe.exec(content)) !== null) {
        const names = match[1].split(",").map(n => n.trim().split(/\s+as\s+/)[0].trim());
        for (const name of names) {
          if (!imports.has(name)) imports.set(name, []);
          imports.get(name).push(relPath);
        }
      }
    }
  }

  return imports;
}

// ── Dynamic pattern collector ────────────────

function collectDynamicPatterns(targetPath, contentMap) {
  const patterns = [];

  for (const [file, content] of contentMap) {
    const relPath = relative(targetPath, file);

    // Look for dynamic references: reflection, getattr, registry patterns
    if (content.includes("getattr") || content.includes("__import__") ||
        content.includes("require(") || content.includes("import(") ||
        content.includes("@app.") || content.includes("@router.") ||
        content.includes("register") || content.includes("Registry")) {
      patterns.push({ file: relPath, content });
    }
  }

  return patterns;
}

// ── File helpers ─────────────────────────────

function collectSourceFiles(targetPath, maxDepth = 10) {
  const files = [];
  const exts = new Set([".ts", ".js", ".mjs", ".tsx", ".jsx", ".py"]);

  function scan(dir, depth) {
    if (depth > maxDepth) return;
    try {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (["node_modules", ".git", "dist", "__pycache__", ".venv", "venv"].includes(entry.name)) continue;
        const full = resolve(dir, entry.name);
        if (entry.isDirectory()) scan(full, depth + 1);
        else if (exts.has(extname(entry.name))) files.push(full);
      }
    } catch { /* skip */ }
  }

  scan(targetPath, 0);
  return files;
}

function isTestFile(filePath) {
  return filePath.includes("/test") || filePath.includes("\\test") ||
    filePath.includes(".test.") || filePath.includes(".spec.") ||
    filePath.includes("_test.") || filePath.startsWith("test_") ||
    filePath.includes("/tests/") || filePath.includes("\\tests\\");
}

function isReExportFile(filePath) {
  return filePath.endsWith("__init__.py") || filePath.endsWith("index.ts") ||
    filePath.endsWith("index.js") || filePath.endsWith("index.mjs");
}
