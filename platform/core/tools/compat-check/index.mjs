/**
 * compat-check — Check for breaking API changes and compatibility issues.
 * Extracted from tool-core.mjs (SPLIT-3).
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { runPatternScan, _gatherDomainPatterns, _langRegistry } from "../tool-utils.mjs";

const COMPAT_PATTERNS = [
  { re: /@deprecated/m, label: "deprecated-usage", severity: "medium", msg: "Contains @deprecated annotation" },
  { re: /\/\*\*[\s\S]*?@breaking[\s\S]*?\*\//m, label: "breaking-change", severity: "high", msg: "Marked as @breaking change" },
  { re: /(?:module\.exports|exports\.)\s*=\s*/m, label: "cjs-export", severity: "low", msg: "CommonJS export in ESM project" },
  { re: /require\s*\(\s*["'][^"']+["']\s*\)/m, label: "cjs-require", severity: "low", msg: "CommonJS require() in ESM project" },
  { re: /\/\/\s*TODO.*(?:remove|delete|deprecat)/im, label: "pending-removal", severity: "medium", msg: "Pending removal marked in TODO" },
];

export { COMPAT_PATTERNS };

/**
 * Check for breaking API changes: removed exports, changed function signatures,
 * deprecated usage, version constraint issues.
 */
export function toolCompatCheck(params) {
  return runPatternScan({
    targetPath: params.path,
    extensions: _langRegistry?.extensionsForDomain("compat") ?? new Set([".ts", ".tsx", ".js", ".jsx", ".mjs"]),
    patterns: _gatherDomainPatterns("compat", COMPAT_PATTERNS),
    toolName: "compat_check",
    heading: "Compatibility Check Results",
    passMsg: "no compatibility issues detected",
    failNoun: "breaking issue(s)",
    postProcess: (findings, _files, cwd) => {
      const pkgPath = resolve(cwd, "package.json");
      if (existsSync(pkgPath)) {
        try {
          const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
          const deps = { ...pkg.dependencies, ...pkg.devDependencies };
          for (const [name, ver] of Object.entries(deps)) {
            if (typeof ver === "string" && ver.startsWith("*")) {
              findings.push({ file: "package.json", line: 0, severity: "high", label: "wildcard-dep", msg: `Wildcard version for ${name}: ${ver}` });
            }
          }
        } catch (err) { console.warn("[tool-core] operation failed:", err?.message ?? err); }
      }
    },
  });
}
