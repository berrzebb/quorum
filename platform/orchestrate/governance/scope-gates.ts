/**
 * Scope gates — file boundary, naming, orphan, perf, dependency, test, constraint checks.
 *
 * All mechanical quality checks: pattern matching, file scanning, git diffing.
 * No execution logic, no agent spawning, no LLM calls.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { execFileSync, execSync } from "node:child_process";
import type { WorkItem } from "../planning/types.js";
import type { NamingRule } from "../../bus/blueprint-parser.js";
import { walkSourceFiles } from "../execution/preflight.js";

// Re-export verify filter from canonical location (platform/core/verify-filter.ts)
export {
  isAllowedVerifier,
  ALLOWED_VERIFY_PREFIXES, VERIFY_SHELL_META, VERIFY_INTERPRETER_RE,
} from "../../core/verify-filter.js";

// ── Stub / Perf Pattern Definitions ──────────

/**
 * Anti-pattern indicators that signal incomplete implementation.
 * Each pattern: [regex, human-readable description].
 */
export const STUB_PATTERNS: [RegExp, string][] = [
  [/\bTODO\b(?!.*\bdecide\b)/i,                    "TODO marker"],
  [/\bFIXME\b/i,                                    "FIXME marker"],
  [/\bnot\s+implemented\b/i,                        "not implemented"],
  [/\bplaceholder\b/i,                              "placeholder"],
  [/\bthrow\s+new\s+Error\(\s*["']not\s+impl/i,     "throw not implemented"],
  [/\breturn\s+\[\s*\]\s*;?\s*\/\//,                "return [] with comment"],
  [/{\s*\/\*\s*\*\/\s*}/,                           "empty block { /* */ }"],
  [/=>\s*{\s*}/,                                    "empty arrow function"],
  [/\(\)\s*{\s*}/,                                  "empty function body"],
  [/console\.log\(\s*["'].*stub/i,                  "console.log stub"],
];

/**
 * High-severity perf patterns from tool-core.mjs PERF_PATTERNS.
 * Duplicated here to avoid MJS->TS boundary crossing.
 * Only high-severity patterns — low/medium are advisory.
 */
export const PERF_PATTERNS: [RegExp, string][] = [
  [/\.forEach\s*\([^)]*=>\s*\{[\s\S]{0,200}\.forEach/,  "Nested .forEach() — potential O(n²)"], // scan-ignore
  [/\.findAll\s*\(\s*\)/,                                  "Unbounded findAll() — add limit/pagination"],
  [/while\s*\(\s*true\s*\)/,                               "while(true) — potential busy loop"], // scan-ignore
  [/JSON\.parse\(.*readFileSync/,                          "Sync file read + JSON.parse — consider async"],
];

// ── Line Scanner (unified) ───────────────────

/**
 * Unified line scanner — scans files against a pattern array.
 * Skips test files, __tests__ dirs, and scan-ignore pragma.
 * Returns "file:line — description" strings.
 */
export function scanLines(repoRoot: string, targetFiles: string[], patterns: [RegExp, string][]): string[] {
  const findings: string[] = [];
  for (const relPath of targetFiles) {
    if (/\.(test|spec)\.[jt]sx?$/.test(relPath) || /\/__tests__\//.test(relPath)) continue;
    const absPath = resolve(repoRoot, relPath);
    if (!existsSync(absPath)) continue;
    let content: string;
    try { content = readFileSync(absPath, "utf8"); } catch (err) { console.error(`[scope-gates] could not read ${relPath}: ${(err as Error).message}`); continue; }
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const trimmed = line.trim();
      if (trimmed.includes("scan-ignore")) continue;
      // Comments are scanned — stubs like "// placeholder" or "// not implemented" must be caught.
      // Pure comment lines only skip patterns that are NOT in STUB_PATTERNS
      // (e.g., perf patterns in comments are benign and should be ignored).
      const isComment = trimmed.startsWith("//") || trimmed.startsWith("*");
      if (isComment) {
        // Only check stub-specific patterns in comments (TODO, FIXME, placeholder, not implemented, etc.)
        // Perf/blueprint patterns in comments are false positives — skip them.
        const hasStubMatch = STUB_PATTERNS.some(([re]) => re.test(line));
        if (!hasStubMatch) continue;
      }
      for (const [pattern, desc] of patterns) {
        if (pattern.test(line)) {
          findings.push(`${relPath}:${i + 1} — ${desc}`);
          break;
        }
      }
    }
  }
  return findings;
}

/** @deprecated Use scanLines(repoRoot, files, STUB_PATTERNS) */
export function scanForStubs(repoRoot: string, targetFiles: string[]): string[] {
  return scanLines(repoRoot, targetFiles, STUB_PATTERNS);
}

/** @deprecated Use scanLines(repoRoot, files, PERF_PATTERNS) */
export function scanForPerfAntiPatterns(repoRoot: string, targetFiles: string[]): string[] {
  return scanLines(repoRoot, targetFiles, PERF_PATTERNS);
}

// ── Git Diff Helper ──────────────────────────

/**
 * Get list of changed files between current state and snapshot ref.
 * Single git process — result shared across scope/test/constraint gates.
 */
const GIT_MAX_BUFFER = 10 * 1024 * 1024; // 10MB — prevents ENOBUFS in repos with many untracked files
const EXCLUDE_PREFIXES = ["node_modules/", "dist/", ".git/", ".next/", "__pycache__/", "target/", "build/"];

/**
 * Query EventStore for changed files recorded by wave-runner.
 * Returns null if no events found (caller should fall back to git).
 */
export function getChangedFilesFromStore(
  store: { query: (filter: Record<string, unknown>) => Array<{ payload: Record<string, unknown> }> } | null,
  snapshotRef?: string,
): string[] | null {
  if (!store) return null;
  try {
    const events = store.query({ eventType: "wave.files", descending: true, limit: 10 });
    if (events.length === 0) return null;
    const allFiles = new Set<string>();
    for (const ev of events) {
      const files = (ev.payload as { files?: string[] }).files;
      if (files) for (const f of files) allFiles.add(f);
    }
    return [...allFiles].filter(f => !EXCLUDE_PREFIXES.some(p => f.startsWith(p)));
  } catch { return null; }
}

/**
 * Get list of changed files between current state and snapshot ref.
 * Prefers EventStore when available; falls back to git.
 */
export function getChangedFiles(
  repoRoot: string,
  snapshotRef = "HEAD",
  store?: { query: (filter: Record<string, unknown>) => Array<{ payload: Record<string, unknown> }> } | null,
): string[] {
  // Try EventStore first (no subprocess, no ENOBUFS risk)
  const fromStore = getChangedFilesFromStore(store ?? null, snapshotRef);
  if (fromStore !== null) return fromStore;

  // Fallback: git
  try {
    const diff = execFileSync("git", ["diff", "--name-only", snapshotRef], {
      cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true, maxBuffer: GIT_MAX_BUFFER,
    }).trim();
    const tracked = diff ? diff.split("\n").filter(Boolean) : [];
    const untracked = execFileSync("git", ["ls-files", "--others", "--exclude-standard"], {
      cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true, maxBuffer: GIT_MAX_BUFFER,
    }).trim();
    const newFiles = untracked ? untracked.split("\n").filter(Boolean) : [];
    const all = [...new Set([...tracked, ...newFiles])];
    return all.filter(f => !EXCLUDE_PREFIXES.some(p => f.startsWith(p)));
  } catch (err) {
    console.error(`[scope-gates] getChangedFiles failed: ${(err as Error).message}`);
    return [];
  }
}

// ── File Scope Enforcement ───────────────────

/**
 * Detect files modified outside assigned targetFiles.
 * Accepts pre-computed diff file list to avoid redundant git calls.
 */
export function detectFileScopeViolations(
  repoRoot: string, completedItems: WorkItem[], diffFiles: string[],
): string[] {
  const allowedFiles = new Set(completedItems.flatMap(i => i.targetFiles));
  const violations: string[] = [];
  for (const file of diffFiles) {
    if (/\.(lock|json|md|css)$/.test(file)) continue;
    if (file.startsWith(".claude/") || file.startsWith("node_modules/") || file.startsWith("dist/")) continue;
    // Config/dotfiles are commonly modified as side-effects (e.g. .gitignore, .env.example, .eslintrc)
    const basename = file.split("/").pop() ?? file;
    if (basename.startsWith(".")) continue;
    if (!allowedFiles.has(file)) {
      violations.push(`${file} — not in any WB's targetFiles`);
    }
  }
  return violations;
}

// ── Blueprint Naming Lint ────────────────────

/** Convert NamingRules to scanLines-compatible patterns. */
export function scanBlueprintViolations(
  repoRoot: string, targetFiles: string[], rules: NamingRule[],
): string[] {
  if (rules.length === 0) return [];
  const patterns: [RegExp, string][] = rules.map(r =>
    [r.violationPattern, `violates naming rule '${r.concept}' (expected: '${r.name}')`]);
  return scanLines(repoRoot, targetFiles, patterns);
}

// ── Orphan File Detection ────────────────────

/**
 * Detect orphan files: source files that exist but are never imported anywhere.
 * Scans all project source files for `import ... from '...<targetFile>'` patterns.
 * Returns list of orphan file paths.
 */
export function detectOrphanFiles(repoRoot: string, targetFiles: string[]): string[] {
  if (targetFiles.length === 0) return [];
  const orphans: string[] = [];

  // Build a set of import-resolvable basenames (without extension)
  const targetBases = new Map<string, string>();
  for (const f of targetFiles) {
    const base = f.replace(/\.[jt]sx?$/, "").replace(/\\/g, "/");
    targetBases.set(base, f);
  }

  // Scan from repo root (not just src/) — projects may use platform/, daemon/, lib/, etc.
  const allSourceFiles = walkSourceFiles(repoRoot, n => /\.[jt]sx?$/.test(n));

  // Scan all source files for imports
  const importedBases = new Set<string>();
  const normRoot = repoRoot.replace(/\\/g, "/").replace(/\/$/, "");
  for (const absFile of allSourceFiles) {
    try {
      const content = readFileSync(absFile, "utf8");
      const fileDir = dirname(absFile).replace(/\\/g, "/");
      const relDir = fileDir.startsWith(normRoot)
        ? fileDir.slice(normRoot.length + 1)
        : fileDir;
      // Match: import ... from "..." or require("...")
      const importMatches = content.matchAll(/(?:from\s+['"]([^'"]+)['"]|require\s*\(\s*['"]([^'"]+)['"]\s*\))/g);
      for (const m of importMatches) {
        const importPath = (m[1] ?? m[2] ?? "").replace(/\.[jt]sx?$/, "").replace(/\\/g, "/");
        // Resolve relative imports to project-relative paths
        if (importPath.startsWith(".")) {
          const parts = relDir.split("/").filter(Boolean);
          const importParts = importPath.split("/");
          for (const seg of importParts) {
            if (seg === ".") continue;
            else if (seg === "..") parts.pop();
            else parts.push(seg);
          }
          importedBases.add(parts.join("/"));
        } else {
          importedBases.add(importPath);
        }
      }
    } catch (err) { console.warn(`[scope-gates] detectOrphanFiles could not read ${absFile}: ${(err as Error).message}`); }
  }

  // Check which target files are never imported
  for (const [base, file] of targetBases) {
    // Skip index files and entry points (typically not imported)
    if (base.endsWith("/index") || base.endsWith("/main") || base.endsWith("/app")) continue;
    // Skip test files
    if (/\.(test|spec)/.test(base)) continue;

    const normalized = base.replace(/\\/g, "/");
    if (!importedBases.has(normalized)) {
      orphans.push(file);
    }
  }

  return orphans;
}

// ── Dependency Audit ─────────────────────────

/**
 * Detect new npm dependencies added during a wave.
 * Compares package.json before/after using git diff.
 * Checks node_modules for copyleft licenses (GPL, AGPL, SSPL).
 * Returns issue strings.
 */
export function auditNewDependencies(repoRoot: string, snapshotRef = "HEAD"): string[] {
  const issues: string[] = [];
  const pkgPath = resolve(repoRoot, "package.json");
  if (!existsSync(pkgPath)) return [];

  try {
    // Get previous package.json dependencies
    let prevDeps: Record<string, string> = {};
    try {
      const prevContent = execFileSync("git", ["show", `${snapshotRef}:package.json`], {
        cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
        windowsHide: true, maxBuffer: GIT_MAX_BUFFER,
      });
      const prevPkg = JSON.parse(prevContent);
      prevDeps = { ...prevPkg.dependencies, ...prevPkg.devDependencies };
    } catch (err) { console.warn(`[scope-gates] could not read previous package.json from git: ${(err as Error).message}`); }

    // Get current dependencies
    const curContent = readFileSync(pkgPath, "utf8");
    const curPkg = JSON.parse(curContent);
    const curDeps: Record<string, string> = { ...curPkg.dependencies, ...curPkg.devDependencies };

    // Find newly added dependencies
    const newDeps = Object.keys(curDeps).filter(d => !(d in prevDeps));
    if (newDeps.length === 0) return [];

    const COPYLEFT = /GPL|AGPL|SSPL|EUPL|CC-BY-SA/i;

    for (const dep of newDeps) {
      const depPkgPath = resolve(repoRoot, "node_modules", dep, "package.json");
      if (!existsSync(depPkgPath)) {
        issues.push(`${dep} — added but not installed (run npm install)`);
        continue;
      }

      try {
        const depPkg = JSON.parse(readFileSync(depPkgPath, "utf8"));
        const license = depPkg.license || depPkg.licenses?.[0]?.type || "UNKNOWN";
        if (COPYLEFT.test(license)) {
          issues.push(`${dep} — copyleft license: ${license} (may restrict distribution)`);
        } else {
          issues.push(`${dep}@${curDeps[dep]} — new dependency (license: ${license})`);
        }
      } catch (err) {
        console.warn(`[scope-gates] could not read license for ${dep}: ${(err as Error).message}`);
        issues.push(`${dep} — could not read license`);
      }
    }
  } catch (err) { console.error(`[scope-gates] auditNewDependencies failed: ${(err as Error).message}`); }

  return issues;
}

// ── Test File Creation Check ─────────────────

/**
 * Check if wave items that should have tests actually created test files.
 * Accepts pre-computed diff file list (from getChangedFiles) to avoid redundant git calls.
 * Returns warning strings.
 */
export function checkTestFileCreation(
  repoRoot: string, completedItems: WorkItem[], diffFiles: string[],
): string[] {
  const warnings: string[] = [];
  const testFiles = diffFiles.filter(f => /\.(test|spec)\.[jt]sx?$/.test(f));

  for (const item of completedItems) {
    const hasTestRunner = item.verify && /\b(vitest|jest|mocha|pytest|cargo\s+test|go\s+test|npm\s+test|node\s+--test)\b/i.test(item.verify);
    const actionMentionsTest = item.action && /\btest\b/i.test(item.action);

    if (hasTestRunner || actionMentionsTest) {
      // Check if any test file was created/modified for this item's target files
      const itemTestFiles = testFiles.filter(tf => {
        return item.targetFiles.some(sf => {
          const base = sf.replace(/\.[jt]sx?$/, "").replace(/\\/g, "/");
          return tf.includes(base) || tf.includes(base.split("/").pop() ?? "");
        });
      });

      if (itemTestFiles.length === 0) {
        warnings.push(`${item.id} — verify uses test runner but no test file was created/modified`);
      }
    }
  }

  return warnings;
}

// ── WB Constraint Enforcement ────────────────

/**
 * Parse WB constraints field and verify mechanical rules.
 * Accepts pre-computed depIssues (from auditNewDependencies) to avoid redundant calls.
 * Returns violation strings.
 */
export function checkWBConstraints(
  repoRoot: string, completedItems: WorkItem[], depIssues: string[],
): string[] {
  const violations: string[] = [];
  for (const item of completedItems) {
    if (!item.constraints) continue;
    const c = item.constraints.toLowerCase();
    if (/no\s+new\s+(dep|pack)|의존성\s*금지|새\s*의존성/i.test(c) && depIssues.length > 0) {
      violations.push(`${item.id} — constraint "no new dependencies" violated: ${depIssues.map(d => d.split(" ")[0]).join(", ")}`);
    }
  }
  return violations;
}

// ── Fix Loop Stagnation Detection ────────────

/**
 * Detect stagnation in the audit fix loop by comparing findings across attempts.
 * Three patterns:
 * 1. Spinning: exact same findings repeated (sorted+joined hash match)
 * 2. Oscillation: findings A->B->A (alternating)
 * 3. No progress: finding count not decreasing
 * Returns description string if stagnation detected, null otherwise.
 */
export function detectFixLoopStagnation(history: string[][]): string | null {
  if (history.length < 2) return null;

  const hashes = history.map(findings => [...findings].sort().join("||"));

  // 1. Spinning: last two attempts have identical findings
  if (hashes.length >= 2 && hashes[hashes.length - 1] === hashes[hashes.length - 2]) {
    return "spinning — identical findings across fix attempts (fixer is not addressing the issues)";
  }

  // 2. Oscillation: A->B->A pattern
  if (hashes.length >= 3) {
    const last3 = hashes.slice(-3);
    if (last3[0] === last3[2] && last3[0] !== last3[1]) {
      return "oscillation — findings alternating between two states (fix introduces new issues)";
    }
  }

  // 3. No progress: count not decreasing AND findings substantially the same
  if (history.length >= 2) {
    const prev = history[history.length - 2]!;
    const curr = history[history.length - 1]!;
    if (curr.length >= prev.length && prev.length > 0) {
      // Check content overlap — if >50% of findings are the same, it's truly stuck
      const prevSet = new Set(prev);
      const overlap = curr.filter(f => prevSet.has(f)).length;
      const overlapRatio = overlap / Math.max(prev.length, 1);
      if (overlapRatio >= 0.5) {
        return `no progress — finding count not decreasing (${prev.length} → ${curr.length}) with ${Math.round(overlapRatio * 100)}% overlap`;
      }
    }
  }

  return null;
}

// ── Project Test Gate ────────────────────────

interface ProjectTestResult {
  ran: boolean;
  passed: boolean;
  summary: string;
}

/**
 * Detect and run the project's test command after each wave.
 * Searches: package.json scripts.test, vitest.config, jest.config.
 * Returns { ran: false } if no test command found (skip silently).
 */
export function runProjectTests(repoRoot: string): ProjectTestResult {
  // Node.js projects: check package.json scripts.test
  const pkgPath = resolve(repoRoot, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
      const testScript = pkg.scripts?.test;
      if (testScript && !/no\s+test/.test(testScript)) {
        try {
          execSync("npm test --if-present", {
            cwd: repoRoot, timeout: 120_000, stdio: "pipe", windowsHide: true,
          });
          return { ran: true, passed: true, summary: "npm test passed" };
        } catch (e: any) {
          const stderr = e?.stderr?.toString?.()?.slice(0, 500) ?? "";
          const stdout = e?.stdout?.toString?.()?.slice(0, 500) ?? "";
          const output = stderr + stdout;
          // "No test files found" means no tests exist yet — not a failure
          if (/no test (files|suites?) found/i.test(output) || /exiting with code 1/i.test(output) && /no test/i.test(output)) {
            return { ran: false, passed: true, summary: "no test files found (skip)" };
          }
          console.error(`[scope-gates] npm test failed: ${stderr || "exit non-zero"}`);
          return { ran: true, passed: false, summary: stderr || "npm test failed" };
        }
      }
    } catch (err) { console.warn(`[scope-gates] invalid package.json: ${(err as Error).message}`); }
  }

  // Vitest config without package.json test script
  const hasVitest = existsSync(resolve(repoRoot, "vitest.config.ts"))
    || existsSync(resolve(repoRoot, "vitest.config.js"))
    || existsSync(resolve(repoRoot, "vitest.config.mts"));
  if (hasVitest) {
    try {
      execSync("npx vitest run", { cwd: repoRoot, timeout: 120_000, stdio: "pipe", windowsHide: true });
      return { ran: true, passed: true, summary: "vitest passed" };
    } catch (e: any) {
      const summary = e?.stderr?.toString?.()?.slice(0, 200) ?? "vitest failed";
      console.error(`[scope-gates] vitest failed: ${summary}`);
      return { ran: true, passed: false, summary };
    }
  }

  // No test command detected
  return { ran: false, passed: true, summary: "no test command found" };
}

// ── Fix-First Severity Classification (v0.6.3 FR-8~10) ──

export type FindingSeverity = "auto-fixable" | "review-required" | "blocking";

/**
 * Classify finding severity into 3 tiers:
 *   auto-fixable: info/low — fixer agent handles without human review
 *   review-required: medium — needs audit but doesn't block
 *   blocking: high/critical — blocks wave progress
 */
export function classifyFindingSeverity(finding: string): FindingSeverity {
  const lower = finding.toLowerCase();

  // blocking: security, critical errors, regressions
  if (/critical|security|vulnerability|injection|xss|regression|overwritten/i.test(lower)) return "blocking";
  if (/high.*severity|high.*risk/i.test(lower)) return "blocking";

  // review-required: medium complexity issues
  if (/medium|complexity|refactor|architecture|design.*violation/i.test(lower)) return "review-required";
  if (/type.*error|not.*assignable|missing.*return/i.test(lower)) return "review-required";

  // auto-fixable: lint, style, stubs, TODO, naming, minor patterns
  return "auto-fixable";
}

/**
 * Partition findings by severity. Returns { autoFixable, reviewRequired, blocking }.
 */
export function partitionFindings(findings: string[]): {
  autoFixable: string[];
  reviewRequired: string[];
  blocking: string[];
} {
  const result = { autoFixable: [] as string[], reviewRequired: [] as string[], blocking: [] as string[] };
  for (const f of findings) {
    const severity = classifyFindingSeverity(f);
    if (severity === "auto-fixable") result.autoFixable.push(f);
    else if (severity === "review-required") result.reviewRequired.push(f);
    else result.blocking.push(f);
  }
  return result;
}

// ── Regression Detection ─────────────────────

/**
 * Detect file overwrites by comparing current state against snapshot.
 * Overwrite = more than 50% of the original file's lines were deleted.
 * This catches "Write instead of Edit" where agents replace entire file content.
 */
export function detectRegressions(repoRoot: string, targetFiles: string[], snapshotRef = "HEAD"): string[] {

  const uniqueFiles = [...new Set(targetFiles)];
  if (uniqueFiles.length === 0) return [];

  const regressions: string[] = [];

  // Batch: single git diff for all files (O(1) subprocess instead of O(N))
  let numstatOutput: string;
  try {
    numstatOutput = execFileSync("git", ["diff", "--numstat", snapshotRef, "--", ...uniqueFiles], {
      cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true, maxBuffer: GIT_MAX_BUFFER,
    }).trim();
  } catch (err) { console.error(`[scope-gates] git diff --numstat failed: ${(err as Error).message}`); return []; }

  if (!numstatOutput) return [];

  // Batch: single git ls-files to identify tracked files
  let trackedOutput: string;
  try {
    trackedOutput = execFileSync("git", ["ls-files", "--", ...uniqueFiles], {
      cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true, maxBuffer: GIT_MAX_BUFFER,
    }).trim();
  } catch (err) { console.error(`[scope-gates] git ls-files failed: ${(err as Error).message}`); return []; }

  const trackedSet = new Set(trackedOutput.split("\n").map(l => l.trim()).filter(Boolean));

  for (const line of numstatOutput.split("\n")) {
    const parts = line.split("\t");
    if (parts.length < 3) continue;
    const additions = parseInt(parts[0] ?? "0", 10);
    const deletions = parseInt(parts[1] ?? "0", 10);
    const file = parts[2]!;

    if (deletions < 10) continue;
    if (!trackedSet.has(file)) continue;
    // Skip orchestrator internal files — these are managed by quorum, not agents
    if (file.startsWith(".claude/") || file.startsWith("docs/plan/")) continue;

    let currentLines = 0;
    try {
      const content = readFileSync(resolve(repoRoot, file), "utf8");
      currentLines = content.split("\n").length;
    } catch (err) { console.warn(`[scope-gates] could not read ${file} for regression check: ${(err as Error).message}`); continue; }

    const originalLines = currentLines - additions + deletions;
    if (originalLines <= 0) continue;

    const deleteRatio = deletions / originalLines;
    if (deleteRatio > 0.5) {
      const pct = Math.round(deleteRatio * 100);
      regressions.push(`${file}: ${pct}% of original overwritten (+${additions} -${deletions}, was ${originalLines} lines) — agent used Write instead of Edit`);
    }
  }

  return regressions;
}
