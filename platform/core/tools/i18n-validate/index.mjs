/**
 * i18n-validate — Validate i18n locale parity and hardcoded strings.
 * Extracted from tool-core.mjs (SPLIT-3).
 */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { resolve, relative } from "node:path";
import { walkDir } from "../tool-utils.mjs";

const HARDCODED_RE = />\s*[A-Z가-힣][A-Za-z가-힣\s]{2,30}\s*</m;

export { HARDCODED_RE };

/**
 * Validate i18n locale parity: ensure all keys exist in all locale files,
 * detect hardcoded user-facing strings in components.
 */
export function toolI18nValidate(params) {
  const { path: targetPath } = params;
  const cwd = process.cwd();
  const target = resolve(targetPath || cwd);

  const findings = [];

  // 1. Find locale JSON files
  const localeFiles = [];
  const localeDirs = [
    resolve(target, "locales"),
    resolve(target, "src", "locales"),
    resolve(target, "public", "locales"),
    resolve(target, "web", "src", "locales"),
  ];

  for (const dir of localeDirs) {
    if (!existsSync(dir)) continue;
    try {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (e.isFile() && e.name.endsWith(".json")) {
          localeFiles.push({ path: resolve(dir, e.name), name: e.name });
        }
        // Also check subdirectory pattern (locales/en/translation.json)
        if (e.isDirectory()) {
          const nested = resolve(dir, e.name);
          try {
            for (const f of readdirSync(nested)) {
              if (f.endsWith(".json")) {
                localeFiles.push({ path: resolve(nested, f), name: `${e.name}/${f}` });
              }
            }
          } catch (err) { console.warn("[tool-core] operation failed:", err?.message ?? err); }
        }
      }
    } catch (err) { console.warn("[tool-core] operation failed:", err?.message ?? err); }
  }

  if (localeFiles.length >= 2) {
    // Compare key sets across locale files
    const keysByFile = new Map();

    function flattenKeys(obj, prefix = "") {
      const keys = [];
      for (const [k, v] of Object.entries(obj)) {
        const full = prefix ? `${prefix}.${k}` : k;
        if (v && typeof v === "object" && !Array.isArray(v)) {
          keys.push(...flattenKeys(v, full));
        } else {
          keys.push(full);
        }
      }
      return keys;
    }

    for (const lf of localeFiles) {
      try {
        const data = JSON.parse(readFileSync(lf.path, "utf8"));
        keysByFile.set(lf.name, new Set(flattenKeys(data)));
      } catch (err) {
        console.warn("[tool-core] locale file parse failed:", err?.message ?? err);
        findings.push({ file: lf.name, line: 0, severity: "medium", label: "parse-error", msg: "Failed to parse locale file" });
      }
    }

    // Cross-compare
    const allFiles = [...keysByFile.keys()];
    for (let i = 0; i < allFiles.length; i++) {
      for (let j = i + 1; j < allFiles.length; j++) {
        const keysA = keysByFile.get(allFiles[i]);
        const keysB = keysByFile.get(allFiles[j]);
        if (!keysA || !keysB) continue;

        for (const k of keysA) {
          if (!keysB.has(k)) {
            findings.push({ file: allFiles[j], line: 0, severity: "high", label: "i18n-parity", msg: `Missing key: "${k}" (exists in ${allFiles[i]})` });
          }
        }
        for (const k of keysB) {
          if (!keysA.has(k)) {
            findings.push({ file: allFiles[i], line: 0, severity: "high", label: "i18n-parity", msg: `Missing key: "${k}" (exists in ${allFiles[j]})` });
          }
        }
      }
    }
  }

  // 2. Scan for hardcoded strings in JSX
  const jsxExt = new Set([".tsx", ".jsx"]);
  const stat_ = statSync(target, { throwIfNoEntry: false });
  const jsxFiles = stat_?.isDirectory() ? walkDir(target, jsxExt, 5) : [];

  for (const file of jsxFiles) {
    let content;
    try { content = readFileSync(file, "utf8"); } catch (err) { console.warn("[tool-core] file read failed:", err?.message ?? err); continue; }
    const lines = content.split(/\r?\n/);

    for (let i = 0; i < lines.length; i++) {
      if (HARDCODED_RE.test(lines[i]) && !lines[i].includes("t(") && !lines[i].includes("i18n")) {
        findings.push({
          file: relative(cwd, file).replace(/\\/g, "/"),
          line: i + 1,
          severity: "medium",
          label: "i18n-hardcoded",
          msg: "Possible hardcoded UI text — use i18n key",
        });
      }
    }
  }

  const scannedCount = localeFiles.length + jsxFiles.length;

  if (findings.length === 0) {
    return { text: "i18n_validate: pass — locale parity OK, no hardcoded strings.", summary: `${scannedCount} files scanned, 0 findings` };
  }

  const rows = ["## i18n Validation Results\n"];
  rows.push("| File | Line | Severity | Issue |");
  rows.push("|------|------|----------|-------|");
  for (const f of findings.slice(0, 100)) {
    rows.push(`| ${f.file} | ${f.line} | ${f.severity} | ${f.msg} |`);
  }
  if (findings.length > 100) rows.push(`\n... and ${findings.length - 100} more`);

  const highCount = findings.filter(f => f.severity === "high").length;
  const verdict = highCount > 0 ? `fail — ${highCount} parity violation(s)` : `warn — ${findings.length} i18n issue(s)`;
  rows.push(`\n**Verdict**: ${verdict}`);

  return {
    text: rows.join("\n"),
    summary: `${scannedCount} files, ${findings.length} findings (${highCount} parity)`,
    json: { total: findings.length, high: highCount, localeFiles: localeFiles.length, findings: findings.slice(0, 100) },
  };
}
