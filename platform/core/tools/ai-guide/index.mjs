/**
 * ai-guide/index.mjs — Tool: ai_guide
 *
 * Synthesize a project guide from code_map, dependency_graph, and doc_coverage.
 * Extracted from tool-core.mjs (SPLIT-4).
 */
import { readFileSync, statSync } from "node:fs";
import { resolve, relative } from "node:path";
import {
  _langRegistry,
  safePathOrError,
  walkDir,
  parseFile,
} from "../tool-utils.mjs";
import { toolCodeMap } from "../code-map/index.mjs";
import { toolDependencyGraph } from "../dependency-graph/index.mjs";
import { toolDocCoverage } from "../doc-coverage/index.mjs";

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
  } catch (err) { console.warn("[ai-guide] package.json read failed:", err?.message ?? err); }

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
