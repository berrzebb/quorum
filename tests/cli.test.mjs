#!/usr/bin/env node
/**
 * CLI Tests — quorum CLI subcommands.
 *
 * Run: node --test tests/cli.test.mjs
 */

import { strict as assert } from "node:assert";
import { describe, it, before, after } from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(__dirname, "..", "dist", "platform", "cli", "index.js");

function runCli(args, opts = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
    cwd: opts.cwd || process.cwd(),
    timeout: 10000,
    env: { ...process.env, ...opts.env },
  });
}

// ═══ 1. Help ══════════════════════════════════════════════════════════

describe("quorum help", () => {
  it("shows help with no args", () => {
    const result = runCli([]);
    assert.ok(result.stdout.includes("quorum"));
    assert.ok(result.stdout.includes("Commands:"));
    assert.equal(result.status, 0);
  });

  it("shows help with --help flag", () => {
    const result = runCli(["--help"]);
    assert.ok(result.stdout.includes("Commands:"));
    assert.equal(result.status, 0);
  });

  it("shows help with help command", () => {
    const result = runCli(["help"]);
    assert.ok(result.stdout.includes("setup"));
    assert.ok(result.stdout.includes("daemon"));
    assert.ok(result.stdout.includes("status"));
    assert.ok(result.stdout.includes("audit"));
    assert.ok(result.stdout.includes("tool"));
    assert.ok(result.stdout.includes("ask"));
  });

  it("shows error for unknown command", () => {
    const result = runCli(["nonexistent"]);
    assert.ok(result.stderr.includes("Unknown command"));
    assert.equal(result.status, 1);
  });
});

// ═══ 2. Status ════════════════════════════════════════════════════════

describe("quorum status", () => {
  it("runs without error in any directory", () => {
    const tmp = mkdtempSync(join(tmpdir(), "cli-status-"));
    try {
      const result = runCli(["status"], { cwd: tmp });
      assert.equal(result.status, 0);
      assert.ok(result.stdout.includes("Audit gate:"));
      assert.ok(result.stdout.includes("Retro gate:"));
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("shows audit status from audit-status.json", () => {
    const tmp = mkdtempSync(join(tmpdir(), "cli-status-"));
    const claudeDir = join(tmp, ".claude");
    mkdirSync(claudeDir, { recursive: true });
    writeFileSync(join(claudeDir, "audit-status.json"), JSON.stringify({ status: "changes_requested", pendingCount: 1 }));

    try {
      const result = runCli(["status"], { cwd: tmp });
      assert.ok(result.stdout.includes("PENDING"));
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

// ═══ 3. Setup ═════════════════════════════════════════════════════════

describe("quorum setup", () => {
  let tmpDir;

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "cli-setup-"));
  });

  after(() => {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates config and directories", () => {
    const result = runCli(["setup", "--yes"], { cwd: tmpDir });
    assert.equal(result.status, 0);
    assert.ok(result.stdout.includes("Setup complete"));

    // Verify created files
    assert.ok(existsSync(join(tmpDir, ".claude", "quorum", "config.json")));
    // Evidence submitted via audit_submit tool — no file creation
    assert.ok(existsSync(join(tmpDir, ".mcp.json")));
  });

  it("is idempotent (second run does not overwrite)", () => {
    const configPath = join(tmpDir, ".claude", "quorum", "config.json");
    const before = readFileSync(configPath, "utf8");

    const result = runCli(["setup", "--yes"], { cwd: tmpDir });
    assert.equal(result.status, 0);

    const after = readFileSync(configPath, "utf8");
    assert.equal(before, after);
  });

  it("registers MCP server in .mcp.json", () => {
    const mcpConfig = JSON.parse(readFileSync(join(tmpDir, ".mcp.json"), "utf8"));
    assert.ok(mcpConfig.mcpServers.quorum);
    assert.equal(mcpConfig.mcpServers.quorum.command, "node");
  });
});

// ═══ 4. Tool ══════════════════════════════════════════════════════════

describe("quorum tool", () => {
  it("shows tool list with no args", () => {
    const result = runCli(["tool"]);
    assert.equal(result.status, 0);
    assert.ok(result.stdout.includes("code_map"));
    assert.ok(result.stdout.includes("dependency_graph"));
    assert.ok(result.stdout.includes("audit_scan"));
  });
});

// ═══ 5. Ask ═══════════════════════════════════════════════════════════

describe("quorum ask", () => {
  it("shows deprecated message", () => {
    const result = runCli(["ask"]);
    assert.equal(result.status, 0);
    assert.ok(result.stdout.includes("Deprecated"));
  });
});

// ═══ 6. Plan ══════════════════════════════════════════════════════════

describe("quorum plan", () => {
  it("runs list subcommand in empty dir", () => {
    const tmp = mkdtempSync(join(tmpdir(), "cli-plan-"));
    try {
      const result = runCli(["plan"], { cwd: tmp });
      assert.equal(result.status, 0);
      assert.ok(result.stdout.includes("No work breakdowns"));
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
