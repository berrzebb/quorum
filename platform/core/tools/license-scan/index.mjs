/**
 * license-scan — Check dependency licenses and PII patterns in source.
 * Extracted from tool-core.mjs (SPLIT-3).
 */
import { readFileSync, existsSync, statSync } from "node:fs";
import { resolve, relative } from "node:path";
import { _langRegistry, walkDir } from "../tool-utils.mjs";

const PII_PATTERNS = [
  { re: /(?:password|passwd|secret|api_?key|token)\s*[:=]\s*["'][^"']{3,}/im, label: "hardcoded-secret", severity: "high", msg: "Potential hardcoded secret" },
  { re: /\b\d{3}-\d{2}-\d{4}\b/m, label: "ssn-pattern", severity: "high", msg: "SSN-like pattern in source" },
  { re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z]{2,}\b/im, label: "email-literal", severity: "low", msg: "Hardcoded email address" },
];

export { PII_PATTERNS };

/**
 * Check dependency licenses for copyleft/unknown risks,
 * PII patterns in source, and security-sensitive imports.
 */
export function toolLicenseScan(params) {
  const { path: targetPath } = params;
  const cwd = process.cwd();
  const target = resolve(targetPath || cwd);

  const findings = [];

  // 1. Check package.json license field
  const pkgPath = resolve(target, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
      if (!pkg.license) {
        findings.push({ file: "package.json", line: 0, severity: "medium", label: "no-license", msg: "No license field in package.json" });
      }

      // Check dependencies for known copyleft
      const COPYLEFT = /GPL|AGPL|SSPL|EUPL|CC-BY-SA/i;
      const PERMISSIVE = /MIT|ISC|BSD|Apache|Unlicense|0BSD/i;
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };

      // Read node_modules package.json for license info
      for (const depName of Object.keys(deps)) {
        const depPkgPath = resolve(target, "node_modules", depName, "package.json");
        if (!existsSync(depPkgPath)) continue;
        try {
          const depPkg = JSON.parse(readFileSync(depPkgPath, "utf8"));
          const lic = depPkg.license || depPkg.licenses?.[0]?.type || "";
          if (COPYLEFT.test(lic)) {
            findings.push({ file: `node_modules/${depName}`, line: 0, severity: "high", label: "copyleft-dep", msg: `Copyleft license: ${lic}` });
          } else if (!PERMISSIVE.test(lic) && lic) {
            findings.push({ file: `node_modules/${depName}`, line: 0, severity: "low", label: "unknown-license", msg: `Non-standard license: ${lic}` });
          }
        } catch (err) { console.warn("[tool-core] operation failed:", err?.message ?? err); }
      }
    } catch (err) { console.warn("[tool-core] operation failed:", err?.message ?? err); }
  }

  // 2. Scan source for PII patterns
  const extSet = _langRegistry?.allExtensions() ?? new Set([".ts", ".tsx", ".js", ".jsx", ".mjs"]);
  const stat_ = statSync(target, { throwIfNoEntry: false });
  const files = stat_?.isDirectory() ? walkDir(target, extSet, 5) : [];

  for (const file of files) {
    let content;
    try { content = readFileSync(file, "utf8"); } catch (err) { console.warn("[tool-core] file read failed:", err?.message ?? err); continue; }
    const lines = content.split(/\r?\n/);
    const spec = _langRegistry?.forFile(file);
    const cPrefixes = spec?.commentPrefixes ?? ["//", "*"];

    for (let i = 0; i < lines.length; i++) {
      if (cPrefixes.some(p => lines[i].trimStart().startsWith(p))) continue;
      for (const pat of PII_PATTERNS) {
        if (pat.re.test(lines[i])) {
          findings.push({
            file: relative(cwd, file).replace(/\\/g, "/"),
            line: i + 1,
            severity: pat.severity,
            label: pat.label,
            msg: pat.msg,
          });
        }
      }
    }
  }

  if (findings.length === 0) {
    return { text: "license_scan: pass — no compliance issues detected.", summary: `${files.length} files scanned, 0 findings` };
  }

  const rows = ["## License & Compliance Scan Results\n"];
  rows.push("| File | Line | Severity | Issue |");
  rows.push("|------|------|----------|-------|");
  for (const f of findings) {
    rows.push(`| ${f.file} | ${f.line} | ${f.severity} | ${f.msg} |`);
  }

  const highCount = findings.filter(f => f.severity === "high").length;
  const verdict = highCount > 0 ? `fail — ${highCount} compliance violation(s)` : `warn — ${findings.length} note(s)`;
  rows.push(`\n**Verdict**: ${verdict}`);

  return {
    text: rows.join("\n"),
    summary: `${files.length} source files + deps, ${findings.length} findings (${highCount} high)`,
    json: { total: findings.length, high: highCount, findings },
  };
}
