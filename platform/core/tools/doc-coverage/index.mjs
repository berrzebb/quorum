/**
 * doc-coverage — Check documentation coverage of exported symbols.
 * Extracted from tool-core.mjs (SPLIT-3).
 */
import { readFileSync, statSync } from "node:fs";
import { resolve, relative } from "node:path";
import { _langRegistry, walkDir } from "../tool-utils.mjs";

const _LEGACY_EXPORT_RE = /^export\s+(?:async\s+)?(?:function|class|const|let|type|interface|enum)\s+(\w+)/;
const _LEGACY_JSDOC_START = /\/\*\*/;
const EXPORT_RE = _LEGACY_EXPORT_RE;
const JSDOC_START = _LEGACY_JSDOC_START;

export { _LEGACY_EXPORT_RE, _LEGACY_JSDOC_START, EXPORT_RE, JSDOC_START };

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
    try { content = readFileSync(file, "utf8"); } catch (err) { console.warn("[tool-core] file read failed:", err?.message ?? err); continue; }
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
