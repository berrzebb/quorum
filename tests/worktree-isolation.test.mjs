/**
 * Tests for worktree isolation invariants.
 *
 * Verifies that audit infrastructure correctly isolates per-worktree:
 * - lock files
 * - debounce files
 * - session files
 * - Codex cwd (-C flag)
 * - pre-verification cwd
 * - REFERENCES_DIR (absolute, not relative)
 *
 * These tests prevent regression of the REPO_ROOT hardcoding bugs
 * that caused audit failures in parallel worktree contexts (tetris2 incident).
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { resolve, dirname, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CORE_DIR = resolve(__dirname, "..", "core");
const ADAPTER_DIR = resolve(__dirname, "..", "adapters", "claude-code");

// ── deriveAuditCwd logic (replicated from audit.mjs for unit testing) ──
function deriveAuditCwd(path, repoRoot = "/repo") {
  if (!path) return repoRoot;
  const worktreeMatch = path.replace(/\\/g, "/").match(/(.+\/.claude\/worktrees\/[^/]+)\//);
  if (worktreeMatch) return worktreeMatch[1];
  return repoRoot;
}

describe("deriveAuditCwd", () => {
  it("returns REPO_ROOT when no path", () => {
    assert.equal(deriveAuditCwd(null, "/repo"), "/repo");
    assert.equal(deriveAuditCwd(undefined, "/repo"), "/repo");
    assert.equal(deriveAuditCwd("", "/repo"), "/repo");
  });

  it("returns REPO_ROOT for main repo path", () => {
    assert.equal(
      deriveAuditCwd("/repo/src/index.ts", "/repo"),
      "/repo",
    );
  });

  it("returns worktree root for worktree path (Unix)", () => {
    assert.equal(
      deriveAuditCwd("/repo/.claude/worktrees/agent-abc123/src/index.ts", "/repo"),
      "/repo/.claude/worktrees/agent-abc123",
    );
  });

  it("returns worktree root for worktree path (Windows backslashes)", () => {
    assert.equal(
      deriveAuditCwd("D:\\Projects\\tetris2\\.claude\\worktrees\\agent-abc123\\src\\index.ts", "D:\\Projects\\tetris2"),
      "D:/Projects/tetris2/.claude/worktrees/agent-abc123",
    );
  });

  it("handles nested .claude paths without false match", () => {
    // A path that contains .claude but NOT in worktrees pattern
    assert.equal(
      deriveAuditCwd("/repo/.claude/quorum/config.json", "/repo"),
      "/repo",
    );
  });

  it("extracts correct root from deeply nested worktree paths", () => {
    assert.equal(
      deriveAuditCwd("/repo/.claude/worktrees/agent-xyz/sub/deep/src/index.ts", "/repo"),
      "/repo/.claude/worktrees/agent-xyz",
    );
  });
});

// ── audit.mjs source code invariants ──
// After split: read all sub-modules to get the combined source
describe("audit.mjs worktree isolation invariants", () => {
  const auditDir = resolve(CORE_DIR, "audit");
  const auditModules = ["index.mjs", "args.mjs", "session.mjs", "scope.mjs", "pre-verify.mjs", "codex-runner.mjs", "solo-verdict.mjs"];
  let auditSource;
  try {
    auditSource = auditModules.map(f => readFileSync(resolve(auditDir, f), "utf8")).join("\n");
  } catch {
    // Fallback: original monolithic file (pre-split)
    auditSource = readFileSync(resolve(CORE_DIR, "audit.mjs"), "utf8");
  }

  it("has zero cwd:REPO_ROOT in audit chain functions", () => {
    // Find all `cwd: REPO_ROOT` occurrences
    const matches = auditSource.match(/cwd:\s*REPO_ROOT/g) || [];
    assert.equal(
      matches.length, 0,
      `Found ${matches.length} cwd:REPO_ROOT — all should use auditCwd/cwd/respondCwd parameter`,
    );
  });

  it("has no process.exit() in audit chain (except --help)", () => {
    const lines = auditSource.split("\n");
    const exits = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Skip comments (lines that only contain comments or are part of comment blocks)
      if (line.trim().startsWith("//") || line.trim().startsWith("*")) continue;
      if (line.includes("process.exit(")) {
        const context = lines.slice(Math.max(0, i - 3), i + 1).join("\n");
        if (!context.includes("--help") && !context.includes("usage()")) {
          exits.push({ line: i + 1, code: line.trim() });
        }
      }
    }
    assert.equal(
      exits.length, 0,
      `Found process.exit() at lines: ${exits.map(e => `${e.line}: ${e.code}`).join(", ")}. Use process.exitCode instead to preserve .finally() lock cleanup.`,
    );
  });

  it("buildCodexArgs receives cwd parameter", () => {
    assert.match(auditSource, /function buildCodexArgs\(args,\s*resumeTarget,\s*cwd\)/);
  });

  it("buildCodexArgs uses cwd for -C flag", () => {
    // The -C flag should use `cwd || REPO_ROOT`, not bare REPO_ROOT
    const buildFn = auditSource.match(/function buildCodexArgs[\s\S]*?^}/m)?.[0] ?? "";
    assert.match(buildFn, /cwd \|\| REPO_ROOT/);
    assert.doesNotMatch(
      buildFn.replace(/cwd \|\| REPO_ROOT/g, ""),
      /"-C",\s*\n\s*REPO_ROOT/,
    );
  });

  it("REFERENCES_DIR uses absolute path", () => {
    // Should NOT use relative(REPO_ROOT, ...) — absolute path required for worktree context
    assert.doesNotMatch(auditSource, /relative\(REPO_ROOT.*REFERENCES_DIR/);
    // Should use resolveReferencesDir(safeLocale) which delegates to resolvePluginPath() for absolute paths
    assert.match(auditSource, /resolveReferencesDir\(safeLocale\)/);
  });

  it("session path is runtime-resolved (not module-level constant)", () => {
    // Should have getSessionPath() function
    assert.match(auditSource, /function getSessionPath\(\)/);
    // Should NOT have `const sessionPath = resolve(HOOKS_DIR`
    assert.doesNotMatch(auditSource, /const sessionPath\s*=\s*resolve\(HOOKS_DIR/);
  });

  it("computeChangedFiles accepts root parameter", () => {
    assert.match(auditSource, /function computeChangedFiles\(markdown,\s*root\)/);
  });

  it("runPreVerification passes root to all sub-checks", () => {
    const fn = auditSource.match(/function runPreVerification[\s\S]*?^}/m)?.[0] ?? "";
    assert.match(fn, /computeChangedFiles\(markdown,\s*root\)/);
    assert.match(fn, /runTscLocally\(root\)/);
    assert.match(fn, /runEslintLocally\(changedFiles,\s*root\)/);
    assert.match(fn, /runTestsLocally\(testCmds,\s*root\)/);
  });

  it("infra_failure verdict is recorded to SQLite on Codex failure", () => {
    assert.match(auditSource, /infra_failure.*auditor exited|mode.*infra_failure/);
    assert.match(auditSource, /bridge\.recordTransition[\s\S]*?infra_failure/);
  });
});

// ── index.mjs worktree isolation ──
describe("index.mjs worktree isolation invariants", () => {
  const indexSource = readFileSync(resolve(ADAPTER_DIR, "index.mjs"), "utf8");

  // Evidence detection via audit_submit MCP tool — no file-based detection needed

  it("quality_rules supports preset object format", () => {
    assert.match(indexSource, /qr\.presets/);
    assert.match(indexSource, /Array\.isArray\(qr\)/);
  });
});

// ── worktree-create.mjs nesting guard ──
describe("worktree-create.mjs nesting guard", () => {
  const createSource = readFileSync(resolve(ADAPTER_DIR, "worktree-create.mjs"), "utf8");

  it("resolves MAIN_ROOT from git common-dir", () => {
    assert.match(createSource, /git-common-dir/);
    assert.match(createSource, /MAIN_ROOT/);
  });

  it("blocks nested worktree creation", () => {
    assert.match(createSource, /nested worktree detected/i);
    assert.match(createSource, /depth.*1/i);
  });
});

// ── implementer.md no-abandon policy ──
describe("implementer.md no-abandon policy", () => {
  const implSource = readFileSync(resolve(ADAPTER_DIR, "agents", "implementer.md"), "utf8");

  it("evidence submission is marked mandatory", () => {
    assert.match(implSource, /MANDATORY.*no exceptions/i);
    assert.match(implSource, /no-abandon policy/i);
  });

  it("has infra_failure exit condition", () => {
    assert.match(implSource, /infra_failure/i);
    assert.match(implSource, /Do NOT WIP commit/);
  });

  it("does not have isolation: worktree in frontmatter", () => {
    const frontmatter = implSource.match(/---[\s\S]*?---/)?.[0] ?? "";
    assert.doesNotMatch(frontmatter, /isolation/);
  });

  it("references quality_rules.presets for CQ", () => {
    assert.match(implSource, /quality_rules\.presets/);
  });
});

// ── config.json quality_rules presets ──
describe("config.json quality_rules presets", () => {
  const config = JSON.parse(readFileSync(resolve(CORE_DIR, "config.json"), "utf8"));

  it("quality_rules is object with presets array", () => {
    assert.equal(typeof config.quality_rules, "object");
    assert.ok(Array.isArray(config.quality_rules.presets));
  });

  it("has presets for multiple languages", () => {
    const labels = config.quality_rules.presets.map(p => p.label);
    assert.ok(labels.includes("typescript"), "missing typescript preset");
    assert.ok(labels.includes("python"), "missing python preset");
    assert.ok(labels.includes("rust"), "missing rust preset");
    assert.ok(labels.includes("go"), "missing go preset");
  });

  it("each preset has required fields", () => {
    for (const preset of config.quality_rules.presets) {
      assert.ok(preset.detect, `preset ${preset.label} missing detect`);
      assert.ok(preset.label, `preset missing label`);
      assert.ok(Array.isArray(preset.checks), `preset ${preset.label} missing checks array`);
      assert.ok(typeof preset.precedence === "number", `preset ${preset.label} missing precedence`);
    }
  });

  it("each check has id, label, command", () => {
    for (const preset of config.quality_rules.presets) {
      for (const check of preset.checks) {
        assert.ok(check.id, `check in ${preset.label} missing id`);
        assert.ok(check.label, `check in ${preset.label} missing label`);
        assert.ok(check.command, `check in ${preset.label} missing command`);
      }
    }
  });
});
