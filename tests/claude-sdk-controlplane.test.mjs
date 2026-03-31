#!/usr/bin/env node
/**
 * SDK-13: Claude SDK — Control Plane Integration Tests
 *
 * Tests that Claude SDK tool-bridge, runtime, and permissions correctly consume
 * the Phase 1 control plane foundations:
 * - Tool capability registry (replaces hardcoded tool list)
 * - Registry-based permission decisions (isReadOnly, isDestructive)
 * - Session ledger integration
 * - Compact handoff support
 *
 * Run: node --test tests/claude-sdk-controlplane.test.mjs
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

// ── Module imports ─────────────────────────────────

const { ClaudeSdkToolBridge } = await import(
  "../dist/platform/providers/claude-sdk/tool-bridge.js"
);
const { ClaudePermissionBridge } = await import(
  "../dist/platform/providers/claude-sdk/permissions.js"
);
const { ClaudeSdkRuntime } = await import(
  "../dist/platform/providers/claude-sdk/runtime.js"
);
const { InMemorySessionLedger } = await import(
  "../dist/platform/providers/session-ledger.js"
);
const { ProviderApprovalGate, AllowAllPolicy } = await import(
  "../dist/platform/bus/provider-approval-gate.js"
);

// ═══ 1. Tool Bridge — Registry Integration ═══════════════════════════════

describe("ClaudeSdkToolBridge — registry integration", () => {
  it("getAvailableTools returns 26 tools from canonical registry", () => {
    const tools = ClaudeSdkToolBridge.getAvailableTools();
    assert.equal(tools.length, 26);
  });

  it("getAvailableTools includes all tool categories", () => {
    const tools = ClaudeSdkToolBridge.getAvailableTools();
    // Always-loaded
    assert.ok(tools.includes("code_map"));
    assert.ok(tools.includes("audit_submit"));
    // Domain tools
    assert.ok(tools.includes("perf_scan"));
    assert.ok(tools.includes("a11y_scan"));
    // Lifecycle tools
    assert.ok(tools.includes("track_archive"));
    assert.ok(tools.includes("act_analyze"));
  });

  it("buildToolConfig with role uses buildToolSurface", async () => {
    const bridge = new ClaudeSdkToolBridge({
      allowedTools: ["code_map"],
      useMcpServer: false,
      repoRoot: "/tmp/test",
    });

    // SDK not installed → returns fallback
    const config = await bridge.buildToolConfig({
      repoRoot: "/tmp/test",
      allowedTools: ["code_map"],
      role: "implementer",
      domains: ["perf"],
    });

    // Should be fallback since SDK isn't installed
    assert.equal(config.available, false);
    assert.equal(config.fallback, "cli_exec");
  });
});

// ═══ 2. Permissions — Registry-Based Filtering ═══════════════════════════

describe("ClaudePermissionBridge — registry-based filtering", () => {
  let ledger;
  let gate;
  let sessionRef;

  beforeEach(() => {
    ledger = new InMemorySessionLedger();
    gate = new ProviderApprovalGate(ledger);
    sessionRef = {
      provider: "claude",
      executionMode: "agent_sdk",
      providerSessionId: "sdk-session-1",
    };
    ledger.upsert({
      quorumSessionId: "q-session-1",
      providerRef: sessionRef,
      startedAt: Date.now(),
      updatedAt: Date.now(),
      state: "running",
    });
  });

  it("plan mode: allows read-only registry tools", () => {
    const bridge = new ClaudePermissionBridge(
      { mode: "plan", enforceQuorumGate: false },
      gate,
    );

    // These are known read-only tools per the registry
    const readOnlyTools = ["code_map", "blast_radius", "dependency_graph", "coverage_map"];
    for (const tool of readOnlyTools) {
      const result = bridge.checkToolPermission(tool, sessionRef);
      assert.equal(result.allowed, true, `Expected ${tool} allowed in plan mode`);
      assert.ok(result.reason.includes("read-only"), `${tool}: ${result.reason}`);
    }
  });

  it("plan mode: blocks non-read-only registry tools", () => {
    const bridge = new ClaudePermissionBridge(
      { mode: "plan", enforceQuorumGate: false },
      gate,
    );

    // These are known non-read-only tools
    const writeTools = ["audit_submit", "skill_sync", "track_archive"];
    for (const tool of writeTools) {
      const result = bridge.checkToolPermission(tool, sessionRef);
      assert.equal(result.allowed, false, `Expected ${tool} blocked in plan mode`);
      assert.ok(result.reason.includes("blocked"), `${tool}: ${result.reason}`);
    }
  });

  it("plan mode: blocks unknown tools (not in registry)", () => {
    const bridge = new ClaudePermissionBridge(
      { mode: "plan", enforceQuorumGate: false },
      gate,
    );

    const unknownTools = ["write_file", "bash", "edit_file"];
    for (const tool of unknownTools) {
      const result = bridge.checkToolPermission(tool, sessionRef);
      assert.equal(result.allowed, false, `Expected ${tool} blocked`);
      assert.ok(result.reason.includes("unknown tool blocked"), `${tool}: ${result.reason}`);
    }
  });

  it("acceptEdits mode: allows non-destructive registry tools", () => {
    const bridge = new ClaudePermissionBridge(
      { mode: "acceptEdits", enforceQuorumGate: false },
      gate,
    );

    const result = bridge.checkToolPermission("code_map", sessionRef);
    assert.equal(result.allowed, true);
    assert.ok(result.reason.includes("acceptEdits"));
  });

  it("acceptEdits mode: allows unknown tools (fail-open for adapter tools)", () => {
    const bridge = new ClaudePermissionBridge(
      { mode: "acceptEdits", enforceQuorumGate: false },
      gate,
    );

    // write_file is not in registry → isKnownTool returns false → allowed
    const result = bridge.checkToolPermission("write_file", sessionRef);
    assert.equal(result.allowed, true);
  });
});

// ═══ 3. Runtime — Ledger Integration ═════════════════════════════════════

describe("ClaudeSdkRuntime — ledger integration", () => {
  it("accepts ledger option in constructor", () => {
    const ledger = new InMemorySessionLedger();
    const runtime = new ClaudeSdkRuntime({ ledger });
    assert.equal(runtime.provider, "claude");
    assert.equal(runtime.mode, "agent_sdk");
  });

  it("accepts empty options (backward compat)", () => {
    const runtime = new ClaudeSdkRuntime();
    assert.equal(runtime.provider, "claude");
  });

  it("complete() and fail() are still callable without ledger", () => {
    const runtime = new ClaudeSdkRuntime();
    // Should not throw
    runtime.complete("nonexistent");
    runtime.fail("nonexistent");
  });
});

// ═══ 4. Runtime — Ledger Records via Mocked SDK ═════════════════════════

describe("ClaudeSdkRuntime — ledger records (mocked SDK)", () => {
  /** Subclass that bypasses real SDK dependency */
  class TestableRuntime extends ClaudeSdkRuntime {
    constructor(opts) {
      super(opts);
      this.sdkChecked = true;
      this.sdkMethods = {
        createSession: async () => ({ id: "mock-sdk-session" }),
        sendMessage: async () => {},
      };
    }
    async isAvailable() { return true; }
  }

  it("start() records session in ledger", async () => {
    const ledger = new InMemorySessionLedger();
    const runtime = new TestableRuntime({ ledger });

    const ref = await runtime.start({
      prompt: "test prompt",
      cwd: "/tmp",
      sessionId: "q-session-42",
      contractId: "contract-7",
    });

    assert.equal(ref.provider, "claude");
    assert.equal(ref.executionMode, "agent_sdk");

    // Verify ledger was populated
    const record = ledger.findByProviderSession(ref.providerSessionId);
    assert.ok(record, "should find record in ledger");
    assert.equal(record.quorumSessionId, "q-session-42");
    assert.equal(record.contractId, "contract-7");
    assert.equal(record.state, "running");
  });

  it("complete() updates ledger to completed", async () => {
    const ledger = new InMemorySessionLedger();
    const runtime = new TestableRuntime({ ledger });

    const ref = await runtime.start({
      prompt: "test",
      cwd: "/tmp",
      sessionId: "q-session-43",
    });

    runtime.complete(ref.providerSessionId);

    const record = ledger.findByProviderSession(ref.providerSessionId);
    assert.ok(record);
    assert.equal(record.state, "completed");
  });

  it("fail() updates ledger to failed", async () => {
    const ledger = new InMemorySessionLedger();
    const runtime = new TestableRuntime({ ledger });

    const ref = await runtime.start({
      prompt: "test",
      cwd: "/tmp",
      sessionId: "q-session-44",
    });

    runtime.fail(ref.providerSessionId);

    const record = ledger.findByProviderSession(ref.providerSessionId);
    assert.ok(record);
    assert.equal(record.state, "failed");
  });

  it("start() without ledger works fine (backward compat)", async () => {
    const runtime = new TestableRuntime();

    const ref = await runtime.start({
      prompt: "test",
      cwd: "/tmp",
      sessionId: "q-session-45",
    });

    assert.ok(ref.providerSessionId);
    // No ledger → no record, no error
  });
});
