#!/usr/bin/env node
/**
 * SDK-14: Event Normalization — Shared Runtime Model Tests
 *
 * Tests that Codex and Claude events produce identical shapes through:
 * - Standard payload extraction (approval, item, terminal)
 * - Daemon state projection (provider-agnostic event → state snapshot)
 * - Capability enrichment parity (both mappers annotate tool events)
 *
 * Run: node --test tests/event-normalization.test.mjs
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

const { CodexAppServerMapper } = await import(
  "../dist/platform/providers/codex/app-server/mapper.js"
);
const { ClaudeSdkEventMapper } = await import(
  "../dist/platform/providers/claude-sdk/mapper.js"
);
const { CODEX_NOTIFICATIONS } = await import(
  "../dist/platform/providers/codex/app-server/protocol.js"
);
const {
  extractApprovalPayload,
  extractItemPayload,
  extractTerminalPayload,
  projectEventsToState,
  createRuntimeEvent,
} = await import("../dist/platform/providers/event-mapper.js");

const codexRef = {
  provider: "codex",
  executionMode: "app_server",
  providerSessionId: "codex-session-1",
  threadId: "thread-1",
};
const claudeRef = {
  provider: "claude",
  executionMode: "agent_sdk",
  providerSessionId: "claude-session-1",
};

// ═══ 1. Mapper Parity ═══════════════════════════════════════════════════

describe("Event normalization — mapper parity", () => {
  const codexMapper = new CodexAppServerMapper();
  const claudeMapper = new ClaudeSdkEventMapper();

  it("both mappers produce same event kind set", () => {
    const codexKinds = new Set();
    const claudeKinds = new Set();

    // Codex events
    for (const method of Object.values(CODEX_NOTIFICATIONS)) {
      const event = codexMapper.normalize(
        { method, params: { threadId: "t1", requestId: "r1", kind: "tool", reason: "test" } },
        codexRef,
      );
      if (event) codexKinds.add(event.kind);
    }

    // Claude events
    const claudeTypes = [
      "session_start", "message_start", "tool_use_start", "content_block_delta",
      "tool_use_complete", "message_complete", "permission_request",
      "session_complete", "session_error",
    ];
    for (const type of claudeTypes) {
      const event = claudeMapper.normalize({ type }, claudeRef);
      if (event) claudeKinds.add(event.kind);
    }

    // Both should produce the same 9 kinds
    assert.deepStrictEqual([...codexKinds].sort(), [...claudeKinds].sort());
  });

  it("both mappers enrich tool-related events with capability metadata", () => {
    // Codex: approval_requested for known tool
    const codexApproval = codexMapper.normalize(
      {
        method: CODEX_NOTIFICATIONS.APPROVAL_REQUESTED,
        params: { requestId: "r1", threadId: "t1", kind: "tool", reason: "code_map" },
      },
      codexRef,
    );

    // Claude: permission_request for known tool
    const claudeApproval = claudeMapper.normalize(
      { type: "permission_request", name: "code_map" },
      claudeRef,
    );

    // Both should have toolCapability
    assert.ok(codexApproval.payload.toolCapability, "Codex should enrich approval");
    assert.ok(claudeApproval.payload.toolCapability, "Claude should enrich approval");

    // Same shape
    assert.equal(codexApproval.payload.toolCapability.isReadOnly, true);
    assert.equal(claudeApproval.payload.toolCapability.isReadOnly, true);
    assert.equal(codexApproval.payload.toolCapability.isDestructive, false);
    assert.equal(claudeApproval.payload.toolCapability.isDestructive, false);
  });

  it("both mappers enrich tool_use events with capability metadata", () => {
    // Codex item_completed with tool_call
    const codexItem = codexMapper.normalize(
      {
        method: CODEX_NOTIFICATIONS.ITEM_COMPLETED,
        params: { itemId: "i1", turnId: "tn1", threadId: "t1", kind: "tool_call", content: "perf_scan" },
      },
      codexRef,
    );

    // Claude tool_use_complete
    const claudeItem = claudeMapper.normalize(
      { type: "tool_use_complete", name: "perf_scan" },
      claudeRef,
    );

    assert.ok(codexItem.payload.toolCapability, "Codex should enrich item");
    assert.ok(claudeItem.payload.toolCapability, "Claude should enrich item");

    // Same enrichment
    assert.equal(codexItem.payload.toolCapability.isReadOnly, true);
    assert.equal(claudeItem.payload.toolCapability.isReadOnly, true);
  });
});

// ═══ 2. Standard Payload Extractors ═════════════════════════════════════

describe("Standard payload extractors", () => {
  it("extractApprovalPayload normalizes both formats", () => {
    // Codex style
    const codexPayload = extractApprovalPayload({
      requestId: "req-1",
      kind: "tool",
      reason: "code_map",
      scope: ["code_map"],
      toolCapability: { isReadOnly: true, isDestructive: false, isConcurrencySafe: true },
    });
    assert.equal(codexPayload.requestId, "req-1");
    assert.equal(codexPayload.kind, "tool");
    assert.equal(codexPayload.reason, "code_map");
    assert.ok(codexPayload.toolCapability);

    // Claude style (with snake_case)
    const claudePayload = extractApprovalPayload({
      request_id: "req-2",
      name: "blast_radius",
      toolCapability: { isReadOnly: true, isDestructive: false, isConcurrencySafe: true },
    });
    assert.equal(claudePayload.requestId, "req-2");
    assert.equal(claudePayload.reason, "blast_radius");
    assert.ok(claudePayload.toolCapability);
  });

  it("extractItemPayload normalizes both formats", () => {
    const item = extractItemPayload({
      itemId: "item-1",
      kind: "tool_call",
      status: "completed",
      content: "result",
    });
    assert.equal(item.itemId, "item-1");
    assert.equal(item.kind, "tool_call");
    assert.equal(item.status, "completed");

    const snakeItem = extractItemPayload({
      item_id: "item-2",
    });
    assert.equal(snakeItem.itemId, "item-2");
  });

  it("extractTerminalPayload normalizes both formats", () => {
    const completed = extractTerminalPayload({ summary: "done" });
    assert.equal(completed.summary, "done");
    assert.equal(completed.error, undefined);

    const failed = extractTerminalPayload({ error: "timeout" });
    assert.equal(failed.error, "timeout");

    const withMessage = extractTerminalPayload({ message: "connection lost" });
    assert.equal(withMessage.error, "connection lost");
  });
});

// ═══ 3. Daemon State Projection ═════════════════════════════════════════

describe("projectEventsToState — provider-agnostic", () => {
  it("projects Codex events to state", () => {
    const events = [
      createRuntimeEvent(codexRef, "thread_started", {}),
      createRuntimeEvent(codexRef, "turn_started", {}),
      createRuntimeEvent(codexRef, "item_started", { kind: "tool_call" }),
      createRuntimeEvent(codexRef, "item_completed", { kind: "tool_call" }),
      createRuntimeEvent(codexRef, "turn_completed", {}),
    ];

    const state = projectEventsToState(events);
    assert.equal(state.provider, "codex");
    assert.equal(state.status, "running");
    assert.equal(state.turnCount, 1);
    assert.equal(state.itemCount, 1);
    assert.equal(state.pendingApprovals, 0);
  });

  it("projects Claude events to state", () => {
    const events = [
      createRuntimeEvent(claudeRef, "thread_started", {}),
      createRuntimeEvent(claudeRef, "turn_started", {}),
      createRuntimeEvent(claudeRef, "turn_started", {}),
      createRuntimeEvent(claudeRef, "session_completed", {}),
    ];

    const state = projectEventsToState(events);
    assert.equal(state.provider, "claude");
    assert.equal(state.status, "completed");
    assert.equal(state.turnCount, 2);
  });

  it("tracks pending approvals", () => {
    const events = [
      createRuntimeEvent(codexRef, "thread_started", {}),
      createRuntimeEvent(codexRef, "approval_requested", { requestId: "r1" }),
      createRuntimeEvent(codexRef, "approval_requested", { requestId: "r2" }),
    ];

    const state = projectEventsToState(events);
    assert.equal(state.pendingApprovals, 2);
    assert.equal(state.status, "running");
  });

  it("tracks capability enrichment", () => {
    const events = [
      createRuntimeEvent(codexRef, "thread_started", {}),
      createRuntimeEvent(codexRef, "item_completed", {
        kind: "tool_call",
        toolCapability: { isReadOnly: true, isDestructive: false, isConcurrencySafe: true },
      }),
    ];

    const state = projectEventsToState(events);
    assert.equal(state.hasCapabilityEnrichment, true);
  });

  it("projects session_failed to failed status", () => {
    const events = [
      createRuntimeEvent(claudeRef, "thread_started", {}),
      createRuntimeEvent(claudeRef, "session_failed", { error: "timeout" }),
    ];

    const state = projectEventsToState(events);
    assert.equal(state.status, "failed");
  });

  it("accumulates from existing state", () => {
    const existing = {
      provider: "codex",
      providerSessionId: "sess-1",
      status: "running",
      turnCount: 3,
      itemCount: 10,
      pendingApprovals: 1,
      hasCapabilityEnrichment: false,
    };

    const newEvents = [
      createRuntimeEvent(codexRef, "turn_started", {}),
      createRuntimeEvent(codexRef, "item_started", {}),
    ];

    const state = projectEventsToState(newEvents, existing);
    assert.equal(state.turnCount, 4); // 3 + 1
    assert.equal(state.itemCount, 11); // 10 + 1
    assert.equal(state.pendingApprovals, 1); // unchanged
  });

  it("returns idle state with no events", () => {
    const state = projectEventsToState([]);
    assert.equal(state.status, "idle");
    assert.equal(state.turnCount, 0);
    assert.equal(state.itemCount, 0);
  });
});
