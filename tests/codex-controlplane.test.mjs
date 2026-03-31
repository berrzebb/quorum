#!/usr/bin/env node
/**
 * SDK-12: Codex App Server — Control Plane Integration Tests
 *
 * Tests that Codex App Server runtime and mapper correctly consume
 * the Phase 1 control plane foundations:
 * - Tool capability registry (enrichment of approval/item events)
 * - Session ledger (traceability)
 * - Compact handoff (wave context injection)
 * - Output cursor (delta reads in poll)
 * - Approval gate (auto-routing)
 *
 * Run: node --test tests/codex-controlplane.test.mjs
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, appendFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ── Module imports ─────────────────────────────────

const { CodexAppServerMapper } = await import(
  "../dist/platform/providers/codex/app-server/mapper.js"
);
const { CodexAppServerRuntime } = await import(
  "../dist/platform/providers/codex/app-server/runtime.js"
);
const { InMemorySessionLedger } = await import(
  "../dist/platform/providers/session-ledger.js"
);
const { ProviderApprovalGate, AllowAllPolicy } = await import(
  "../dist/platform/bus/provider-approval-gate.js"
);
const { CODEX_NOTIFICATIONS } = await import(
  "../dist/platform/providers/codex/app-server/protocol.js"
);
const {
  getCapability,
  isDestructive,
  isReadOnly,
  isConcurrencySafe,
  allToolNames,
  isKnownTool,
  buildToolSurface,
  TOOL_CAPABILITIES,
} = await import("../dist/platform/core/tools/capability-registry.js");

const ref = {
  provider: "codex",
  executionMode: "app_server",
  providerSessionId: "test-session-1",
  threadId: "thread-1",
};

// ═══ 1. Mapper — Capability Enrichment ═══════════════════════════════════

describe("CodexAppServerMapper — capability enrichment", () => {
  let mapper;

  beforeEach(() => {
    mapper = new CodexAppServerMapper();
  });

  it("enriches approval_requested for known tool with capability metadata", () => {
    const event = mapper.normalize(
      {
        method: CODEX_NOTIFICATIONS.APPROVAL_REQUESTED,
        params: {
          requestId: "req-1",
          threadId: "thread-1",
          kind: "tool",
          reason: "code_map",
        },
      },
      ref,
    );

    assert.ok(event, "event should not be null");
    assert.equal(event.kind, "approval_requested");
    assert.ok(event.payload.toolCapability, "should have toolCapability");
    assert.equal(event.payload.toolCapability.isReadOnly, true);
    assert.equal(event.payload.toolCapability.isDestructive, false);
    assert.equal(typeof event.payload.toolCapability.isConcurrencySafe, "boolean");
  });

  it("does NOT enrich approval_requested for non-tool kind", () => {
    const event = mapper.normalize(
      {
        method: CODEX_NOTIFICATIONS.APPROVAL_REQUESTED,
        params: {
          requestId: "req-2",
          threadId: "thread-1",
          kind: "command",
          reason: "rm -rf /tmp/test",
        },
      },
      ref,
    );

    assert.ok(event);
    assert.equal(event.payload.toolCapability, undefined);
  });

  it("does NOT enrich approval_requested for unknown tool", () => {
    const event = mapper.normalize(
      {
        method: CODEX_NOTIFICATIONS.APPROVAL_REQUESTED,
        params: {
          requestId: "req-3",
          threadId: "thread-1",
          kind: "tool",
          reason: "unknown_external_tool",
        },
      },
      ref,
    );

    assert.ok(event);
    assert.equal(event.payload.toolCapability, undefined);
  });

  it("enriches item_completed for tool_call kind with capability", () => {
    const event = mapper.normalize(
      {
        method: CODEX_NOTIFICATIONS.ITEM_COMPLETED,
        params: {
          itemId: "item-1",
          turnId: "turn-1",
          threadId: "thread-1",
          kind: "tool_call",
          status: "completed",
          content: "blast_radius",
        },
      },
      ref,
    );

    assert.ok(event);
    assert.equal(event.kind, "item_completed");
    assert.ok(event.payload.toolCapability, "should have toolCapability for tool_call");
    assert.equal(event.payload.toolCapability.isReadOnly, true);
  });

  it("does NOT enrich item_completed for message kind", () => {
    const event = mapper.normalize(
      {
        method: CODEX_NOTIFICATIONS.ITEM_COMPLETED,
        params: {
          itemId: "item-2",
          turnId: "turn-1",
          threadId: "thread-1",
          kind: "message",
          status: "completed",
          content: "hello",
        },
      },
      ref,
    );

    assert.ok(event);
    assert.equal(event.payload.toolCapability, undefined);
  });

  it("still maps standard events without enrichment", () => {
    const threadEvent = mapper.normalize(
      { method: CODEX_NOTIFICATIONS.THREAD_STARTED, params: { threadId: "t1", createdAt: 1 } },
      ref,
    );
    assert.ok(threadEvent);
    assert.equal(threadEvent.kind, "thread_started");

    const turnEvent = mapper.normalize(
      { method: CODEX_NOTIFICATIONS.TURN_COMPLETED, params: { threadId: "t1", turnId: "tn1", itemCount: 3 } },
      ref,
    );
    assert.ok(turnEvent);
    assert.equal(turnEvent.kind, "turn_completed");
  });
});

// ═══ 2. Runtime — Constructor Options ═══════════════════════════════════

describe("CodexAppServerRuntime — constructor options", () => {
  it("accepts old-style positional arguments (backward compat)", () => {
    const runtime = new CodexAppServerRuntime("codex", ["--app-server"], 30000);
    assert.equal(runtime.provider, "codex");
    assert.equal(runtime.mode, "app_server");
  });

  it("accepts new-style options object", () => {
    const ledger = new InMemorySessionLedger();
    const gate = new ProviderApprovalGate(ledger);
    const runtime = new CodexAppServerRuntime({
      binaryPath: "codex",
      ledger,
      approvalGate: gate,
    });
    assert.equal(runtime.provider, "codex");
    assert.equal(runtime.mode, "app_server");
  });

  it("accepts empty options (all defaults)", () => {
    const runtime = new CodexAppServerRuntime();
    assert.equal(runtime.provider, "codex");
  });

  it("accepts undefined (backward compat)", () => {
    const runtime = new CodexAppServerRuntime(undefined);
    assert.equal(runtime.provider, "codex");
  });
});

// ═══ 3. Runtime — Output Cursor ══════════════════════════════════════════

describe("CodexAppServerRuntime — output cursor via poll", () => {
  let tmpDir;
  let runtime;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "codex-cp-test-"));
    // Create a subclass that exposes internal state for testing
    runtime = new CodexAppServerRuntime();
  });

  it("poll returns empty for session without output cursor", async () => {
    // Manually inject a session (bypassing client connection)
    runtime.sessions = new Map([
      ["test-session", {
        ref: { provider: "codex", executionMode: "app_server", providerSessionId: "test-session" },
        status: "running",
        events: [],
      }],
    ]);

    const events = await runtime.poll({
      provider: "codex",
      executionMode: "app_server",
      providerSessionId: "test-session",
    });
    assert.deepStrictEqual(events, []);
  });
});

// ═══ 4. Capability Registry Bridge ═══════════════════════════════════════

describe("Capability Registry Bridge", () => {
  it("re-exports TOOL_CAPABILITIES with 26 entries", () => {
    assert.equal(TOOL_CAPABILITIES.length, 26);
  });

  it("getCapability returns metadata for known tool", () => {
    const cap = getCapability("code_map");
    assert.ok(cap);
    assert.equal(cap.name, "code_map");
    assert.equal(cap.isReadOnly, true);
    assert.equal(cap.isDestructive, false);
  });

  it("getCapability returns undefined for unknown tool", () => {
    assert.equal(getCapability("nonexistent_tool"), undefined);
  });

  it("isDestructive returns false for read-only tools", () => {
    assert.equal(isDestructive("code_map"), false);
    assert.equal(isDestructive("blast_radius"), false);
  });

  it("isReadOnly returns true for analysis tools", () => {
    assert.equal(isReadOnly("code_map"), true);
    assert.equal(isReadOnly("dependency_graph"), true);
  });

  it("allToolNames returns 26 names", () => {
    const names = allToolNames();
    assert.equal(names.length, 26);
    assert.ok(names.includes("code_map"));
    assert.ok(names.includes("audit_submit"));
  });

  it("isKnownTool distinguishes known/unknown", () => {
    assert.equal(isKnownTool("code_map"), true);
    assert.equal(isKnownTool("write_file"), false);
  });

  it("buildToolSurface returns tools for implementer role", () => {
    const surface = buildToolSurface("implementer");
    assert.ok(surface.tools.length > 0);
    assert.ok(Array.isArray(surface.deferred));
    assert.ok(typeof surface.env === "object");
  });
});
