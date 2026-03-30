#!/usr/bin/env node
/**
 * Codex Provider + Auditor Tests
 *
 * Run: node --test tests/codex-provider.test.mjs
 */

import { strict as assert } from "node:assert";
import { describe, it, before, after } from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const { CodexProvider } = await import("../dist/platform/providers/codex/adapter.js");
const { CodexAuditor } = await import("../dist/platform/providers/codex/auditor.js");
const { QuorumBus } = await import("../dist/platform/bus/bus.js");

let tmpDir;

before(() => { tmpDir = mkdtempSync(join(tmpdir(), "codex-test-")); });
after(() => { try { if (tmpDir) rmSync(tmpDir, { recursive: true, force: true }); } catch (err) { console.warn("codex-provider cleanup failed:", err?.message ?? err); } });

// ═══ 1. CodexProvider ═════════════════════════════════════════════════

describe("CodexProvider", () => {
  it("has correct kind and capabilities", () => {
    const provider = new CodexProvider();
    assert.equal(provider.kind, "codex");
    assert.equal(provider.displayName, "Codex");
    assert.ok(provider.capabilities.includes("file-watch"));
    assert.ok(provider.capabilities.includes("audit"));
    assert.ok(!provider.capabilities.includes("hooks")); // Codex has no native hooks
  });

  it("status() returns disconnected before start()", () => {
    const provider = new CodexProvider();
    const status = provider.status();
    assert.equal(status.connected, false);
    assert.equal(status.activeAgents, 0);
  });

  it("start() connects to bus and emits session.start", async () => {
    const provider = new CodexProvider();
    const bus = new QuorumBus();
    const events = [];
    bus.on("session.start", (e) => events.push(e));

    mkdirSync(join(tmpDir, "start-test"), { recursive: true });

    await provider.start(bus, {
      repoRoot: join(tmpDir, "start-test"),
      auditor: { model: "codex" },
    });

    assert.equal(provider.status().connected, true);
    assert.equal(events.length, 1);
    assert.equal(events[0].source, "codex");
    assert.equal(events[0].payload.mode, "file-watch");

    // Verify .codex/ state dir was created
    assert.ok(existsSync(join(tmpDir, "start-test", ".codex")));

    await provider.stop();
    assert.equal(provider.status().connected, false);
  });

  it("stop() is idempotent", async () => {
    const provider = new CodexProvider();
    await provider.stop();
    await provider.stop();
  });

  it("detects agent activity from .codex/agents.jsonl", async () => {
    const provider = new CodexProvider();
    const bus = new QuorumBus();
    const spawnEvents = [];
    const completeEvents = [];
    bus.on("agent.spawn", (e) => spawnEvents.push(e));
    bus.on("agent.complete", (e) => completeEvents.push(e));

    const root = join(tmpDir, "agent-test");
    const codexDir = join(root, ".codex");
    mkdirSync(root, { recursive: true });

    await provider.start(bus, {
      repoRoot: root,
      auditor: { model: "codex" },
    });

    // Write agent activity to the JSONL log
    const agentLog = join(codexDir, "agents.jsonl");
    writeFileSync(agentLog, JSON.stringify({ type: "spawn", name: "exec-1", role: "executor", model: "codex" }) + "\n");

    // Wait for poll cycle (2s interval + margin)
    await new Promise((r) => setTimeout(r, 3000));

    assert.equal(spawnEvents.length, 1);
    assert.equal(spawnEvents[0].source, "codex");
    assert.equal(spawnEvents[0].payload.name, "exec-1");
    assert.equal(spawnEvents[0].payload.role, "executor");

    // Agent completes
    appendFileSync(agentLog, JSON.stringify({ type: "complete", name: "exec-1" }) + "\n");
    await new Promise((r) => setTimeout(r, 3000));

    assert.equal(completeEvents.length, 1);

    await provider.stop();
  });
});

// ═══ 2. CodexAuditor ══════════════════════════════════════════════════

describe("CodexAuditor", () => {
  it("creates with default config", () => {
    const auditor = new CodexAuditor();
    assert.ok(auditor);
  });

  it("creates with custom config", () => {
    const auditor = new CodexAuditor({
      bin: "/custom/codex",
      model: "gpt-4o",
      timeout: 60000,
      cwd: "/tmp",
    });
    assert.ok(auditor);
  });

  it("available() returns false when codex not installed", async () => {
    const auditor = new CodexAuditor({ bin: "nonexistent-codex-binary-12345" });
    const result = await auditor.available();
    assert.equal(result, false);
  });

  it("audit() returns error result when binary not found", async () => {
    const auditor = new CodexAuditor({
      bin: "nonexistent-codex-binary-12345",
      timeout: 3000,
    });

    const result = await auditor.audit({
      evidence: "test evidence",
      prompt: "review this",
      files: ["a.ts"],
    });

    // Binary not found is an infrastructure failure, not a code review result
    assert.ok(
      result.verdict === "infra_failure" || result.verdict === "changes_requested",
      `Expected infra_failure or changes_requested, got: ${result.verdict}`,
    );
    assert.ok(result.codes.includes("auditor-error") || result.codes.includes("infra-failure"));
    assert.ok(result.duration >= 0);
  });
});

// ═══ 3. Multi-provider registration ═══════════════════════════════════

describe("multi-provider coexistence", () => {
  it("CodexProvider and ClaudeCodeProvider register independently", async () => {
    const { ClaudeCodeProvider } = await import("../dist/platform/providers/claude-code/adapter.js");
    const { registerProvider, listProviders, getProvider } = await import("../dist/platform/providers/provider.js");

    const claude = new ClaudeCodeProvider();
    const codex = new CodexProvider();

    registerProvider(claude);
    registerProvider(codex);

    assert.ok(getProvider("claude-code"));
    assert.ok(getProvider("codex"));

    const all = listProviders();
    assert.ok(all.some((p) => p.kind === "claude-code"));
    assert.ok(all.some((p) => p.kind === "codex"));
  });
});
