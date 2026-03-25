#!/usr/bin/env node
/**
 * Provider Tests — provider registry, ClaudeCodeProvider lifecycle.
 *
 * Run: node --test tests/provider.test.mjs
 */

import { strict as assert } from "node:assert";
import { describe, it, before, after } from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const { registerProvider, getProvider, listProviders } = await import("../dist/providers/provider.js");
const { ClaudeCodeProvider } = await import("../dist/providers/claude-code/adapter.js");
const { QuorumBus } = await import("../dist/bus/bus.js");

let tmpDir;

before(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "provider-test-"));
});

after(() => {
  if (tmpDir && existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
});

// ═══ 1. Provider registry ═════════════════════════════════════════════

describe("provider registry", () => {
  it("registers and retrieves a provider", () => {
    const provider = new ClaudeCodeProvider();
    registerProvider(provider);

    const retrieved = getProvider("claude-code");
    assert.ok(retrieved);
    assert.equal(retrieved.kind, "claude-code");
    assert.equal(retrieved.displayName, "Claude Code");
  });

  it("listProviders returns all registered", () => {
    const all = listProviders();
    assert.ok(all.length >= 1);
    assert.ok(all.some((p) => p.kind === "claude-code"));
  });

  it("getProvider returns undefined for unknown kind", () => {
    const unknown = getProvider("unknown-provider");
    assert.equal(unknown, undefined);
  });
});

// ═══ 2. ClaudeCodeProvider ════════════════════════════════════════════

describe("ClaudeCodeProvider", () => {
  it("has correct kind and capabilities", () => {
    const provider = new ClaudeCodeProvider();
    assert.equal(provider.kind, "claude-code");
    assert.ok(provider.capabilities.includes("hooks"));
    assert.ok(provider.capabilities.includes("worktree"));
    assert.ok(provider.capabilities.includes("audit"));
  });

  it("status() returns disconnected before start()", () => {
    const provider = new ClaudeCodeProvider();
    const status = provider.status();
    assert.equal(status.connected, false);
    assert.equal(status.activeAgents, 0);
    assert.equal(status.pendingAudits, 0);
  });

  it("start() connects to bus and emits session.start", async () => {
    const provider = new ClaudeCodeProvider();
    const bus = new QuorumBus();
    const events = [];
    bus.on("session.start", (e) => events.push(e));

    await provider.start(bus, {
      repoRoot: tmpDir,
      auditor: { model: "codex" },
    });

    assert.equal(provider.status().connected, true);
    assert.equal(events.length, 1);
    assert.equal(events[0].source, "claude-code");

    await provider.stop();
    assert.equal(provider.status().connected, false);
  });

  it("stop() is idempotent", async () => {
    const provider = new ClaudeCodeProvider();
    // Stop without start — should not throw
    await provider.stop();
    await provider.stop();
  });
});
