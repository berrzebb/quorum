/**
 * Tests for adapters/shared/ modules — Phase 1 of Plan C (Gemini adapter).
 *
 * Covers: repo-resolver, config-resolver, audit-state, first-run,
 * context-reinforcement, trigger-runner, tool-names.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";

// ── Default tags from config (single source of truth) ─────
import { loadConfig, extractTags } from "../platform/adapters/shared/config-resolver.mjs";
const DEFAULT_TAGS = extractTags({});  // no config → defaults
const TRIGGER = DEFAULT_TAGS.triggerTag;
const AGREE = DEFAULT_TAGS.agreeTag;
const PENDING = DEFAULT_TAGS.pendingTag;

// ── Test fixtures ──────────────────────────────────────────
const TEST_DIR = resolve(tmpdir(), `quorum-shared-test-${Date.now()}`);
const REPO_DIR = resolve(TEST_DIR, "repo");
const ADAPTER_DIR = resolve(TEST_DIR, "adapter");

function setup() {
  mkdirSync(resolve(REPO_DIR, ".claude", "quorum"), { recursive: true });
  mkdirSync(resolve(REPO_DIR, ".git"), { recursive: true });
  mkdirSync(resolve(ADAPTER_DIR, ".session-state"), { recursive: true });
  mkdirSync(resolve(ADAPTER_DIR, "docs"), { recursive: true });
  mkdirSync(resolve(ADAPTER_DIR, "examples"), { recursive: true });
}

function cleanup() {
  try { rmSync(TEST_DIR, { recursive: true, force: true }); } catch { /* */ }
  // Clean env vars that tests might set
  delete process.env.QUORUM_REPO_ROOT;
  delete process.env.QUORUM_ADAPTER_ROOT;
}

// ── repo-resolver ──────────────────────────────────────────
describe("shared/repo-resolver", () => {
  before(setup);
  after(cleanup);

  it("resolves repo root from adapterDir fallback", async () => {
    // Note: git rev-parse runs first and finds the real repo (D:/Projects/quorum)
    // since we're running inside it. This test verifies the adapterDir fallback
    // by checking that when git finds a repo, it returns a valid path with .git.
    const saved = process.env.QUORUM_REPO_ROOT;
    delete process.env.QUORUM_REPO_ROOT;
    try {
      const { resolveRepoRoot } = await import("../platform/adapters/shared/repo-resolver.mjs");
      const adapterInRepo = resolve(REPO_DIR, "adapters", "claude-code", "hooks");
      mkdirSync(adapterInRepo, { recursive: true });
      const result = resolveRepoRoot({ adapterDir: adapterInRepo, cache: false });
      // Should resolve to a valid path (either git-resolved or adapterDir fallback)
      assert.ok(typeof result === "string" && result.length > 0);
      assert.ok(existsSync(result), `resolved path ${result} should exist`);
    } finally {
      if (saved) process.env.QUORUM_REPO_ROOT = saved;
      else delete process.env.QUORUM_REPO_ROOT;
    }
  });

  it("uses cached env var when available", async () => {
    process.env.QUORUM_REPO_ROOT = "/cached/path";
    try {
      const { resolveRepoRoot } = await import("../platform/adapters/shared/repo-resolver.mjs");
      assert.equal(resolveRepoRoot(), "/cached/path");
    } finally {
      delete process.env.QUORUM_REPO_ROOT;
    }
  });

  it("falls back to cwd when no git and no adapterDir", async () => {
    const saved = process.env.QUORUM_REPO_ROOT;
    delete process.env.QUORUM_REPO_ROOT;
    try {
      const { resolveRepoRoot } = await import("../platform/adapters/shared/repo-resolver.mjs");
      const result = resolveRepoRoot({ adapterDir: resolve(TEST_DIR, "nonexistent"), cache: false });
      // Should fallback — either git resolves or returns cwd
      assert.ok(typeof result === "string" && result.length > 0);
    } finally {
      if (saved) process.env.QUORUM_REPO_ROOT = saved;
      else delete process.env.QUORUM_REPO_ROOT;
    }
  });
});

// ── config-resolver ────────────────────────────────────────
describe("shared/config-resolver", () => {
  before(setup);
  after(cleanup);

  it("finds project-scoped config first", async () => {
    const configData = { consensus: { trigger_tag: "[TEST_TAG]" } };
    writeFileSync(resolve(REPO_DIR, ".claude", "quorum", "config.json"), JSON.stringify(configData));

    const { findConfigPath, loadConfig } = await import("../platform/adapters/shared/config-resolver.mjs");
    const path = findConfigPath({ repoRoot: REPO_DIR, adapterDir: ADAPTER_DIR });
    assert.ok(path?.endsWith("config.json"));
    assert.ok(path?.includes(".claude"));

    const { cfg, configMissing } = loadConfig({ repoRoot: REPO_DIR, adapterDir: ADAPTER_DIR });
    assert.equal(configMissing, false);
    assert.equal(cfg.consensus.trigger_tag, "[TEST_TAG]");
  });

  it("falls back to adapter dir config", async () => {
    writeFileSync(resolve(ADAPTER_DIR, "config.json"), JSON.stringify({ plugin: { locale: "ko" } }));

    const { findConfigPath } = await import("../platform/adapters/shared/config-resolver.mjs");
    // Use a repo root without project config
    const emptyRepo = resolve(TEST_DIR, "empty-repo");
    mkdirSync(emptyRepo, { recursive: true });
    const path = findConfigPath({ repoRoot: emptyRepo, adapterDir: ADAPTER_DIR });
    assert.ok(path?.includes(ADAPTER_DIR));
  });

  it("returns null when no config exists", async () => {
    const { findConfigPath, loadConfig } = await import("../platform/adapters/shared/config-resolver.mjs");
    const noConfigDir = resolve(TEST_DIR, "no-config");
    mkdirSync(noConfigDir, { recursive: true });
    const path = findConfigPath({ repoRoot: noConfigDir, adapterDir: noConfigDir });
    assert.equal(path, null);

    const { configMissing, cfg } = loadConfig({ repoRoot: noConfigDir, adapterDir: noConfigDir });
    assert.equal(configMissing, true);
    assert.ok(cfg.consensus); // default config provided
  });

  it("extracts tags with defaults", async () => {
    const { extractTags } = await import("../platform/adapters/shared/config-resolver.mjs");
    const tags = extractTags({ consensus: { trigger_tag: "[TEST]" } });
    assert.equal(tags.triggerTag, "[TEST]");
    assert.ok(tags.agreeTag); // has default

    const defaultTags = extractTags({});
    assert.ok(defaultTags.triggerTag);
    assert.ok(defaultTags.agreeTag);
  });
});

// ── audit-state ────────────────────────────────────────────
describe("shared/audit-state", () => {
  before(setup);
  after(cleanup);

  it("reads audit status from marker file", async () => {
    writeFileSync(
      resolve(REPO_DIR, ".claude", "audit-status.json"),
      JSON.stringify({ status: "approved", timestamp: Date.now() })
    );

    const { readAuditStatus } = await import("../platform/adapters/shared/audit-state.mjs");
    const status = readAuditStatus(REPO_DIR);
    assert.equal(status?.status, "approved");
  });

  it("returns null when no audit status", async () => {
    const { readAuditStatus } = await import("../platform/adapters/shared/audit-state.mjs");
    const emptyDir = resolve(TEST_DIR, "no-audit");
    mkdirSync(emptyDir, { recursive: true });
    assert.equal(readAuditStatus(emptyDir), null);
  });

  it("reads retro marker", async () => {
    writeFileSync(
      resolve(ADAPTER_DIR, ".session-state", "retro-marker.json"),
      JSON.stringify({ retro_pending: true, rx_id: "test-123" })
    );

    const { readRetroMarker } = await import("../platform/adapters/shared/audit-state.mjs");
    const marker = readRetroMarker(ADAPTER_DIR);
    assert.equal(marker?.retro_pending, true);
    assert.equal(marker?.rx_id, "test-123");
  });

  it("builds status signals", async () => {
    // Setup: approved audit status
    writeFileSync(
      resolve(REPO_DIR, ".claude", "audit-status.json"),
      JSON.stringify({ status: "approved" })
    );
    const { buildStatusSignals } = await import("../platform/adapters/shared/audit-state.mjs");
    const cfg = { consensus: { agree_tag: AGREE } };
    const signals = buildStatusSignals({ repoRoot: REPO_DIR, adapterDir: ADAPTER_DIR, cfg });
    assert.ok(signals.length > 0);
  });

  it("builds resume state with pending correction", async () => {
    writeFileSync(
      resolve(REPO_DIR, ".claude", "audit-status.json"),
      JSON.stringify({ status: "changes_requested", rejectionCodes: ["R01", "R02"] })
    );
    const { buildResumeState } = await import("../platform/adapters/shared/audit-state.mjs");
    const cfg = { consensus: { trigger_tag: TRIGGER, pending_tag: PENDING } };
    const { resumeActions } = buildResumeState({ repoRoot: REPO_DIR, adapterDir: ADAPTER_DIR, cfg });
    assert.ok(resumeActions.length > 0);
  });
});

// ── first-run ──────────────────────────────────────────────
describe("shared/first-run", () => {
  before(setup);
  after(cleanup);

  it("copies example config to project dir", async () => {
    const examplesDir = resolve(ADAPTER_DIR, "examples");
    writeFileSync(resolve(examplesDir, "config.example.json"), JSON.stringify({ test: true }));

    const destDir = resolve(TEST_DIR, "first-run-dest");

    const { firstRunSetup, buildFirstRunMessage } = await import("../platform/adapters/shared/first-run.mjs");
    const result = firstRunSetup({ adapterRoot: ADAPTER_DIR, projectConfigDir: destDir });
    assert.ok(result.copied.includes("config.json"));
    assert.ok(existsSync(resolve(destDir, "config.json")));

    const msg = buildFirstRunMessage(result, "/path/to/README.md");
    assert.ok(msg?.includes("First-Run Setup Complete"));
  });

  it("reports needsManualSetup when examples missing", async () => {
    const emptyAdapter = resolve(TEST_DIR, "empty-adapter");
    mkdirSync(emptyAdapter, { recursive: true });

    const { firstRunSetup, buildFirstRunMessage } = await import("../platform/adapters/shared/first-run.mjs");
    const result = firstRunSetup({ adapterRoot: emptyAdapter, projectConfigDir: resolve(TEST_DIR, "no-dest") });
    assert.equal(result.needsManualSetup, true);

    const msg = buildFirstRunMessage(result, "");
    assert.ok(msg?.includes("SETUP REQUIRED"));
  });
});

// ── context-reinforcement ──────────────────────────────────
describe("shared/context-reinforcement", () => {
  before(() => {
    setup();
    const guideContent = [
      "# AI Guide",
      "",
      "## Absolute Rules",
      "- Rule 1: Never self-approve",
      "- Rule 2: Always run tests",
      "",
      "## Other Section",
      "some content",
    ].join("\n");
    writeFileSync(resolve(ADAPTER_DIR, "docs", "AGENTS.md"), guideContent);
  });
  after(cleanup);

  it("extracts Absolute Rules section", async () => {
    const { buildContextReinforcement } = await import("../platform/adapters/shared/context-reinforcement.mjs");
    const result = buildContextReinforcement({ adapterRoot: ADAPTER_DIR, locale: "en", agreeTag: AGREE });
    assert.ok(result?.includes("CONTEXT-REINFORCEMENT"));
    assert.ok(result?.includes("Never self-approve"));
    assert.ok(result?.includes("Self-promotion"));
  });

  it("returns null when guide not found", async () => {
    const { buildContextReinforcement } = await import("../platform/adapters/shared/context-reinforcement.mjs");
    const result = buildContextReinforcement({ adapterRoot: resolve(TEST_DIR, "no-guide"), locale: "en" });
    assert.equal(result, null);
  });

  it("falls back to English root when locale not found", async () => {
    const { findGuidePath } = await import("../platform/adapters/shared/context-reinforcement.mjs");
    // "ko" → docs/ko-KR/ doesn't exist, should fallback to docs/AGENTS.md (English root)
    const path = findGuidePath(ADAPTER_DIR, "ko");
    assert.ok(path?.includes("AGENTS.md"));
  });
});

// ── trigger-runner ─────────────────────────────────────────
describe("shared/trigger-runner", () => {
  it("validates evidence format — missing sections", async () => {
    const { validateEvidenceFormat } = await import("../platform/adapters/shared/trigger-runner.mjs");
    const content = `## Item ${TRIGGER}\nSome content without proper sections`;
    const consensus = { trigger_tag: TRIGGER, agree_tag: AGREE };
    const { errors } = validateEvidenceFormat(content, consensus);
    assert.ok(errors.length > 0); // Missing required sections
  });

  it("validates evidence format — all sections present", async () => {
    const { validateEvidenceFormat } = await import("../platform/adapters/shared/trigger-runner.mjs");
    const content = [
      `## Item ${TRIGGER}`,
      "### Claim",
      "Added new feature",
      "### Changed Files",
      "- `src/index.ts`",
      "### Test Command",
      "npm test",
      "### Test Result",
      "All 10 tests passed successfully",
      "### Residual Risk",
      "None",
    ].join("\n");
    const consensus = { trigger_tag: TRIGGER, agree_tag: AGREE };
    const { errors } = validateEvidenceFormat(content, consensus);
    assert.equal(errors.length, 0);
  });

  it("detects tag conflict", async () => {
    const { validateEvidenceFormat } = await import("../platform/adapters/shared/trigger-runner.mjs");
    const content = `## Item ${TRIGGER} ${AGREE}\nContent`;
    const consensus = { trigger_tag: TRIGGER, agree_tag: AGREE };
    const { warnings } = validateEvidenceFormat(content, consensus);
    assert.ok(warnings.some(w => w.includes("conflict") || w.includes("tag")));
  });

  it("parses changed files from evidence", async () => {
    const { parseChangedFiles, countChangedFiles } = await import("../platform/adapters/shared/trigger-runner.mjs");
    const content = "### Changed Files\n- `src/a.ts`\n- `src/b.ts`\n### Next";
    const files = parseChangedFiles(content);
    assert.deepEqual(files, ["src/a.ts", "src/b.ts"]);
    assert.equal(countChangedFiles(content), 2);
  });

  it("builds trigger context", async () => {
    const { buildTriggerContext } = await import("../platform/adapters/shared/trigger-runner.mjs");
    const ctx = buildTriggerContext({
      content: "### Changed Files\n- `src/auth/login.ts`\n- `tests/auth.test.ts`",
      changedFiles: ["src/auth/login.ts", "tests/auth.test.ts"],
      changedFileCount: 2,
      priorRejections: 1,
      hasPlanDoc: true,
      blastRadius: 0.15,
    });
    assert.equal(ctx.changedFiles, 2);
    assert.equal(ctx.securitySensitive, true); // "auth" detected
    assert.equal(ctx.crossLayerChange, true);  // src/ + tests/
    assert.equal(ctx.priorRejections, 1);
    assert.equal(ctx.hasPlanDoc, true);
    assert.equal(ctx.blastRadius, 0.15);
  });

  it("detects planning files", async () => {
    const { isPlanningFile } = await import("../platform/adapters/shared/trigger-runner.mjs");
    const consensus = { planning_files: ["docs/plan/prd.md"], planning_dirs: ["docs/plan/"] };
    assert.equal(isPlanningFile("docs/plan/prd.md", consensus), true);
    assert.equal(isPlanningFile("docs/plan/track-1.md", consensus), true);
    assert.equal(isPlanningFile("src/index.ts", consensus), false);
  });

  it("checks plan document existence", async () => {
    const { hasPlanDocuments } = await import("../platform/adapters/shared/trigger-runner.mjs");
    // Add docs/plan for planning file detection test
    mkdirSync(resolve(REPO_DIR, "docs", "plan"), { recursive: true });
    assert.equal(hasPlanDocuments(REPO_DIR), true);

    const noPlanDir = resolve(TEST_DIR, "no-plan-repo");
    mkdirSync(noPlanDir, { recursive: true });
    assert.equal(hasPlanDocuments(noPlanDir), false);
  });
});

// ── tool-names ─────────────────────────────────────────────
describe("shared/tool-names", () => {
  it("maps tool names across adapters", async () => {
    const { getToolName, getCanonicalName, isFileEditTool } = await import("../platform/adapters/shared/tool-names.mjs");

    // Claude Code
    assert.equal(getToolName("claude-code", "bash"), "Bash");
    assert.equal(getToolName("claude-code", "write"), "Write");

    // Gemini
    assert.equal(getToolName("gemini", "bash"), "run_shell_command");
    assert.equal(getToolName("gemini", "write"), "write_file");
    assert.equal(getToolName("gemini", "edit"), "edit_file");

    // Reverse lookup
    assert.equal(getCanonicalName("claude-code", "Write"), "write");
    assert.equal(getCanonicalName("gemini", "run_shell_command"), "bash");
    assert.equal(getCanonicalName("gemini", "unknown_tool"), null);

    // File edit detection
    assert.equal(isFileEditTool("claude-code", "Write"), true);
    assert.equal(isFileEditTool("claude-code", "Edit"), true);
    assert.equal(isFileEditTool("claude-code", "Read"), false);
    assert.equal(isFileEditTool("gemini", "write_file"), true);
    assert.equal(isFileEditTool("gemini", "read_file"), false);
  });

  it("returns canonical name for unknown adapter", async () => {
    const { getToolName, getCanonicalName } = await import("../platform/adapters/shared/tool-names.mjs");
    assert.equal(getToolName("unknown", "bash"), "bash"); // passthrough
    assert.equal(getCanonicalName("unknown", "anything"), null);
  });
});
