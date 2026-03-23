/**
 * Security Scanner — deterministic OWASP pattern detection.
 *
 * Two modes:
 * 1. semgrep available → delegates to semgrep with OWASP rules
 * 2. fallback → built-in regex patterns for common vulnerabilities
 *
 * Catches what LLMs miss due to correlated training biases:
 * SSRF, SQL injection, XSS, path traversal, insecure deserialization,
 * hardcoded secrets, missing auth checks.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, existsSync, statSync } from "node:fs";
import { resolve, extname, relative } from "node:path";
import { walkDir } from "./tools/tool-core.mjs";

// ── OWASP patterns (built-in fallback) ────────────────

const PATTERNS = [
  {
    id: "SEC-01",
    name: "SSRF",
    severity: "critical",
    pattern: /fetch\s*\(\s*[^"'`]|http\.request\s*\(\s*[^"'`]|axios\s*\(\s*\{[^}]*url\s*:\s*[^"'`]/,
    description: "Dynamic URL in fetch/http/axios — potential SSRF",
    extensions: [".ts", ".js", ".mjs", ".tsx", ".jsx"],
  },
  {
    id: "SEC-02",
    name: "SQL Injection",
    severity: "critical",
    pattern: /\$\{.*\}.*(?:SELECT|INSERT|UPDATE|DELETE|WHERE|FROM)\b|`[^`]*(?:SELECT|INSERT|UPDATE|DELETE|WHERE|FROM)[^`]*\$\{/i,
    description: "String interpolation in SQL query — use parameterized queries",
    extensions: [".ts", ".js", ".mjs"],
  },
  {
    id: "SEC-03",
    name: "XSS",
    severity: "high",
    pattern: /innerHTML\s*=|dangerouslySetInnerHTML|document\.write\s*\(/,
    description: "Direct HTML injection — potential XSS",
    extensions: [".ts", ".js", ".tsx", ".jsx"],
  },
  {
    id: "SEC-04",
    name: "Path Traversal",
    severity: "critical",
    pattern: /\.\.\//,
    // Only flag when used in file operations
    contextPattern: /readFile|writeFile|createReadStream|resolve\s*\(.*\.\.\//,
    description: "Path traversal in file operation",
    extensions: [".ts", ".js", ".mjs"],
  },
  {
    id: "SEC-05",
    name: "Hardcoded Secret",
    severity: "high",
    pattern: /(?:password|secret|api_key|apikey|token|auth)\s*[:=]\s*["'][^"']{8,}["']/i,
    description: "Hardcoded credential or secret",
    extensions: [".ts", ".js", ".mjs", ".json", ".env"],
  },
  {
    id: "SEC-06",
    name: "Insecure Deserialization",
    severity: "high",
    pattern: /JSON\.parse\s*\(\s*(?:req\.|request\.|body|params|query)/,
    description: "Parsing untrusted input without validation",
    extensions: [".ts", ".js", ".mjs"],
  },
  {
    id: "SEC-07",
    name: "Command Injection",
    severity: "critical",
    pattern: /exec\s*\(\s*[`"'].*\$\{|exec\s*\(\s*(?!["'`])|child_process.*exec\s*\(\s*[^"'`\[]/,
    description: "Dynamic command execution — potential injection",
    extensions: [".ts", ".js", ".mjs"],
  },
  {
    id: "SEC-08",
    name: "Missing Auth Check",
    severity: "medium",
    pattern: /app\.(get|post|put|patch|delete)\s*\(\s*["'][^"']*["']\s*,\s*(?:async\s*)?\(/,
    description: "Route handler without middleware — verify auth is applied",
    extensions: [".ts", ".js", ".mjs"],
  },
  {
    id: "SEC-09",
    name: "Eval Usage",
    severity: "critical",
    pattern: /\beval\s*\(|new\s+Function\s*\(/,
    description: "eval() or new Function() — code injection risk",
    extensions: [".ts", ".js", ".mjs", ".tsx", ".jsx"],
  },
  {
    id: "SEC-10",
    name: "Sensitive Data Exposure",
    severity: "medium",
    pattern: /console\.(log|info|debug|warn)\s*\(.*(?:password|token|secret|key|credential)/i,
    description: "Logging sensitive data",
    extensions: [".ts", ".js", ".mjs"],
  },
];

// ── Public API ────────────────────────────────

/**
 * Run security scan on a directory.
 * @param {string} targetPath - Directory or file to scan
 * @param {object} options - { useSemgrep: boolean }
 * @returns {{ findings: Finding[], engine: string, summary: object }}
 */
export function securityScan(targetPath, options = {}) {
  const useSemgrep = options.useSemgrep !== false && isToolAvailable("semgrep");

  if (useSemgrep) {
    return runSemgrep(targetPath);
  }

  return runBuiltinScan(targetPath);
}

/**
 * Format scan results for display.
 */
function formatFindings(result) {
  const lines = [];
  lines.push(`Security Scan (${result.engine})`);
  lines.push("─".repeat(50));

  if (result.findings.length === 0) {
    lines.push("✓ No security issues found.");
    return lines.join("\n");
  }

  const bySeverity = { critical: [], high: [], medium: [] };
  for (const f of result.findings) {
    (bySeverity[f.severity] ?? []).push(f);
  }

  for (const [sev, findings] of Object.entries(bySeverity)) {
    if (findings.length === 0) continue;
    const icon = sev === "critical" ? "🔴" : sev === "high" ? "🟠" : "🟡";
    lines.push(`\n${icon} ${sev.toUpperCase()} (${findings.length})`);
    for (const f of findings) {
      lines.push(`  ${f.id} ${f.file}:${f.line} — ${f.description}`);
    }
  }

  lines.push(`\nTotal: ${result.findings.length} finding(s)`);
  return lines.join("\n");
}

// ── semgrep engine ────────────────────────────

function runSemgrep(targetPath) {
  try {
    const result = spawnSync("semgrep", [
      "--config", "p/owasp-top-ten",
      "--json",
      "--quiet",
      targetPath,
    ], {
      encoding: "utf8",
      timeout: 120000,
      shell: process.platform === "win32",
      windowsHide: true,
    });

    const data = JSON.parse(result.stdout || "{}");
    const findings = (data.results ?? []).map((r) => ({
      id: r.check_id?.split(".").pop() ?? "unknown",
      name: r.check_id ?? "unknown",
      severity: r.extra?.severity ?? "medium",
      file: r.path,
      line: r.start?.line ?? 0,
      description: r.extra?.message ?? "",
      code: r.extra?.lines ?? "",
    }));

    return {
      findings,
      engine: "semgrep",
      summary: { total: findings.length, critical: findings.filter((f) => f.severity === "critical").length },
    };
  } catch (err) {
    return { findings: [], engine: "semgrep (error)", summary: { total: 0, error: err.message } };
  }
}

// ── Built-in regex engine ─────────────────────

function runBuiltinScan(targetPath) {
  const findings = [];
  const exts = new Set([".ts", ".js", ".mjs", ".tsx", ".jsx", ".json"]);
  const files = existsSync(targetPath) && statSync(targetPath).isDirectory()
    ? walkDir(targetPath, exts, 10)
    : existsSync(targetPath) ? [targetPath] : [];

  for (const file of files) {
    const ext = extname(file);
    const content = readFileSync(file, "utf8");
    const lines = content.split(/\r?\n/);

    for (const pattern of PATTERNS) {
      if (!pattern.extensions.includes(ext)) continue;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Skip comments and test files
        if (line.trimStart().startsWith("//") || line.trimStart().startsWith("*")) continue;
        if (file.includes("/test") || file.includes(".test.") || file.includes(".spec.")) continue;

        if (pattern.pattern.test(line)) {
          // For path traversal, check context
          if (pattern.contextPattern) {
            if (!pattern.contextPattern.test(line)) continue;
          }

          findings.push({
            id: pattern.id,
            name: pattern.name,
            severity: pattern.severity,
            file: relative(process.cwd(), file),
            line: i + 1,
            description: pattern.description,
            code: line.trim().slice(0, 100),
          });
        }
      }
    }
  }

  return {
    findings,
    engine: "built-in (OWASP patterns)",
    summary: {
      total: findings.length,
      critical: findings.filter((f) => f.severity === "critical").length,
    },
  };
}


// ── gitleaks — git history secret detection (language-agnostic) ──

export function gitleaksScan(repoRoot) {
  const available = isToolAvailable("gitleaks");

  if (available) {
    try {
      const result = spawnSync("gitleaks", ["detect", "--source", repoRoot, "--report-format", "json", "--no-banner", "--exit-code", "0"], {
        encoding: "utf8",
        timeout: 60000,
        shell: process.platform === "win32",
        windowsHide: true,
      });
      const findings = JSON.parse(result.stdout || "[]");
      return {
        findings: findings.map((f) => ({
          id: "LEAK",
          name: f.RuleID ?? "secret",
          severity: "critical",
          file: f.File ?? "",
          line: f.StartLine ?? 0,
          description: `${f.Description ?? "Secret detected"} (${f.Match?.slice(0, 30) ?? ""}...)`,
        })),
        engine: "gitleaks",
      };
    } catch {
      return { findings: [], engine: "gitleaks (error)" };
    }
  }

  // Fallback: basic secret patterns in staged/recent files
  const findings = [];
  try {
    const staged = execFileSync("git", ["diff", "--cached", "--name-only"], {
      cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true,
    }).trim().split("\n").filter(Boolean);

    const SECRET_RE = /(?:AKIA[0-9A-Z]{16}|ghp_[a-zA-Z0-9]{36}|sk-[a-zA-Z0-9]{48}|-----BEGIN (?:RSA |EC )?PRIVATE KEY-----|eyJ[a-zA-Z0-9_-]{20,}\.eyJ)/;

    for (const file of staged) {
      const fullPath = resolve(repoRoot, file);
      if (!existsSync(fullPath)) continue;
      try {
        const content = readFileSync(fullPath, "utf8");
        const lines = content.split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
          if (SECRET_RE.test(lines[i])) {
            findings.push({
              id: "LEAK",
              name: "secret-pattern",
              severity: "critical",
              file,
              line: i + 1,
              description: "Potential secret/key pattern detected",
            });
          }
        }
      } catch { /* skip binary files */ }
    }
  } catch { /* not a git repo */ }

  return { findings, engine: "built-in (secret patterns)" };
}

// ── jscpd — duplicate code detection (150+ languages) ──

function duplicateScan(targetPath) {
  if (!isToolAvailable("jscpd")) {
    return { findings: [], engine: "jscpd (not installed)", available: false };
  }

  try {
    const result = spawnSync("jscpd", [targetPath, "--reporters", "json", "--silent", "--min-lines", "10"], {
      encoding: "utf8",
      timeout: 60000,
      shell: process.platform === "win32",
      windowsHide: true,
    });

    const data = JSON.parse(result.stdout || "{}");
    const findings = (data.duplicates ?? []).map((d) => ({
      id: "DUP",
      name: "duplicate-code",
      severity: "medium",
      file: d.firstFile?.name ?? "",
      line: d.firstFile?.startLoc?.line ?? 0,
      description: `${d.lines ?? 0} duplicate lines with ${d.secondFile?.name ?? "?"}:${d.secondFile?.startLoc?.line ?? 0}`,
    }));

    return { findings, engine: "jscpd" };
  } catch {
    return { findings: [], engine: "jscpd (error)" };
  }
}

// ── npm audit — dependency vulnerabilities ──

export function depAuditScan(repoRoot) {
  try {
    const result = spawnSync("npm", ["audit", "--json", "--audit-level=high"], {
      cwd: repoRoot,
      encoding: "utf8",
      timeout: 30000,
      shell: process.platform === "win32",
      windowsHide: true,
    });

    const data = JSON.parse(result.stdout || "{}");
    const vulns = data.vulnerabilities ?? {};
    const findings = Object.entries(vulns).map(([name, info]) => ({
      id: "DEP",
      name: "vulnerable-dependency",
      severity: info.severity ?? "medium",
      file: "package.json",
      line: 0,
      description: `${name}: ${info.severity} — ${info.via?.[0]?.title ?? info.via?.[0] ?? ""}`,
    }));

    return { findings, engine: "npm audit" };
  } catch {
    return { findings: [], engine: "npm audit (error)" };
  }
}

// ── Import cycle detection (from dependency_graph) ──

function cycleScan(targetPath) {
  try {
    const result = spawnSync(process.execPath, [
      resolve(targetPath, "core", "tools", "tool-runner.mjs"), "dependency_graph", "--path", targetPath, "--json",
    ], {
      encoding: "utf8",
      timeout: 30000,
      windowsHide: true,
    });

    const data = JSON.parse(result.stdout || "{}");
    const cycles = data.cycles ?? [];
    const findings = cycles.map((cycle, i) => ({
      id: "CYCLE",
      name: "import-cycle",
      severity: "medium",
      file: cycle[0] ?? "",
      line: 0,
      description: `Circular import: ${cycle.join(" → ")}`,
    }));

    return { findings, engine: "dependency_graph" };
  } catch {
    return { findings: [], engine: "dependency_graph (error)" };
  }
}

// ── Utility ───────────────────────────────────

function isToolAvailable(name) {
  try {
    const result = spawnSync(name, ["--version"], {
      encoding: "utf8", timeout: 5000,
      shell: process.platform === "win32",
      windowsHide: true,
    });
    return result.status === 0;
  } catch {
    return false;
  }
}
