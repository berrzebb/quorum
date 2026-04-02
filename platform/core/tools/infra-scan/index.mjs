/**
 * infra-scan/index.mjs — Tool: infra_scan
 *
 * Scan infrastructure files (Dockerfile, docker-compose, CI configs)
 * for security and reliability anti-patterns.
 * Extracted from tool-core.mjs (SPLIT-4).
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, relative } from "node:path";

// ═══ Constants ═════════════════════════════════════════════════════════

const INFRA_PATTERNS = [
  { re: /FROM\s+[^:\s]+\s*$/m, label: "no-tag", severity: "high", msg: "Docker FROM without version tag (uses :latest)" },
  { re: /FROM\s+\S+:latest/m, label: "latest-tag", severity: "high", msg: "Docker FROM uses :latest — pin version" },
  { re: /RUN\s+.*curl.*\|\s*(?:sh|bash)/m, label: "pipe-install", severity: "high", msg: "curl | sh — unverified remote execution" },
  { re: /EXPOSE\s+22\b/m, label: "ssh-exposed", severity: "medium", msg: "SSH port exposed in container" },
  { re: /privileged:\s*true/m, label: "privileged", severity: "high", msg: "Privileged container — security risk" },
  { re: /password|secret|api_key|token/im, label: "secret-in-config", severity: "high", msg: "Potential secret in config file" },
  { re: /USER\s+root/m, label: "root-user", severity: "medium", msg: "Container runs as root — use non-root user" },
  { re: /npm\s+install(?!\s+--production|\s+-P)/m, label: "dev-deps-in-prod", severity: "low", msg: "npm install without --production in Dockerfile" },
];

// ═══ Tool: infra_scan ═══════════════════════════════════════════════════

export function toolInfraScan(params) {
  const { path: targetPath } = params;
  const cwd = process.cwd();
  const target = resolve(targetPath || cwd);

  const findings = [];

  // Find infra files
  const infraPatterns = [
    "Dockerfile", "docker-compose.yml", "docker-compose.yaml",
    ".github/workflows", ".gitlab-ci.yml", "Jenkinsfile",
    "nginx.conf", "Caddyfile", "terraform", ".env.example",
  ];

  const infraFiles = [];
  const allExts = new Set([".yml", ".yaml", ".toml", ".conf", ".tf", ".sh", ".dockerfile"]);
  const stat_ = statSync(target, { throwIfNoEntry: false });

  // Direct file checks
  for (const pat of infraPatterns) {
    const p = resolve(target, pat);
    const s = statSync(p, { throwIfNoEntry: false });
    if (s?.isFile()) infraFiles.push(p);
    if (s?.isDirectory()) {
      try {
        for (const e of readdirSync(p, { withFileTypes: true })) {
          if (e.isFile()) infraFiles.push(resolve(p, e.name));
        }
      } catch (err) { console.warn("[infra-scan] operation failed:", err?.message ?? err); }
    }
  }

  // Also check for Dockerfile* patterns
  if (stat_?.isDirectory()) {
    try {
      for (const e of readdirSync(target)) {
        if (e.startsWith("Dockerfile") || e.startsWith("docker-compose") || e === ".dockerignore") {
          infraFiles.push(resolve(target, e));
        }
      }
    } catch (err) { console.warn("[infra-scan] operation failed:", err?.message ?? err); }
  }

  if (infraFiles.length === 0) {
    return { text: "infra_scan: skip — no infrastructure files found.", summary: "0 infra files" };
  }

  for (const file of infraFiles) {
    let content;
    try { content = readFileSync(file, "utf8"); } catch (err) { console.warn("[infra-scan] file read failed:", err?.message ?? err); continue; }
    const lines = content.split(/\r?\n/);

    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trimStart().startsWith("#")) continue;
      for (const pat of INFRA_PATTERNS) {
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
    return { text: "infra_scan: pass — no infrastructure issues detected.", summary: `${infraFiles.length} infra files scanned, 0 findings` };
  }

  const rows = ["## Infrastructure Scan Results\n"];
  rows.push("| File | Line | Severity | Issue |");
  rows.push("|------|------|----------|-------|");
  for (const f of findings) {
    rows.push(`| ${f.file} | ${f.line} | ${f.severity} | ${f.msg} |`);
  }

  const highCount = findings.filter(f => f.severity === "high").length;
  const verdict = highCount > 0 ? `fail — ${highCount} infrastructure violation(s)` : `warn — ${findings.length} issue(s)`;
  rows.push(`\n**Verdict**: ${verdict}`);

  return {
    text: rows.join("\n"),
    summary: `${infraFiles.length} infra files, ${findings.length} findings (${highCount} high)`,
    json: { total: findings.length, high: highCount, findings },
  };
}
