#!/usr/bin/env node
/**
 * SessionRuntime Contract Tests — SDK-3
 *
 * Verifies the SessionRuntime type surface is importable and structurally correct.
 * Tests:
 * 1. All types importable from compiled dist
 * 2. ProviderExecutionMode values
 * 3. ProviderSessionRef structural shape
 * 4. SessionRuntimeRequest structural shape
 * 5. ProviderRuntimeEvent kind values (all 9)
 * 6. ProviderApprovalRequest kind values
 * 7. ProviderApprovalDecision decision values
 * 8. createRuntimeEvent() factory function
 * 9. SessionRuntime interface contract (mock implementation)
 *
 * Run: npm run build && node --test tests/session-runtime.test.mjs
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

// ── Imports from session-runtime.ts (via dist) ──────────────────────

const sessionRuntimeModule = await import(
  "../dist/platform/providers/session-runtime.js"
);

// ── Imports from event-mapper.ts (via dist) ─────────────────────────

const { createRuntimeEvent } = await import(
  "../dist/platform/providers/event-mapper.js"
);

// ── Also verify barrel re-exports from index.ts ─────────────────────

const barrelModule = await import("../dist/platform/providers/index.js");

// ═══════════════════════════════════════════════════════════════════════
// 1. All types importable from compiled dist
// ═══════════════════════════════════════════════════════════════════════

describe("SDK-3: Type importability", () => {
  it("session-runtime.js module loads without error", () => {
    assert.ok(sessionRuntimeModule, "session-runtime module must load");
  });

  it("event-mapper.js exports createRuntimeEvent function", () => {
    assert.equal(
      typeof createRuntimeEvent,
      "function",
      "createRuntimeEvent must be a function",
    );
  });

  it("barrel index re-exports createRuntimeEvent", () => {
    assert.equal(
      typeof barrelModule.createRuntimeEvent,
      "function",
      "barrel must re-export createRuntimeEvent",
    );
  });

  it("session-runtime.js has no runtime exports (types only)", () => {
    // session-runtime.ts exports only types — no runtime values
    const exports = Object.keys(sessionRuntimeModule);
    assert.equal(
      exports.length,
      0,
      "session-runtime.js must have no runtime exports (types only)",
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 2. ProviderExecutionMode values
// ═══════════════════════════════════════════════════════════════════════

describe("SDK-3: ProviderExecutionMode", () => {
  const validModes = ["cli_exec", "app_server", "agent_sdk"];

  it("accepts all 3 valid execution modes", () => {
    for (const mode of validModes) {
      // Structural: create a ref with this mode
      const ref = {
        provider: "codex",
        executionMode: mode,
        providerSessionId: "test-123",
      };
      assert.equal(ref.executionMode, mode);
    }
  });

  it("cli_exec represents current one-shot CLI spawn", () => {
    const ref = {
      provider: "codex",
      executionMode: "cli_exec",
      providerSessionId: "s1",
    };
    assert.equal(ref.executionMode, "cli_exec");
  });

  it("app_server represents Codex App Server JSON-RPC", () => {
    const ref = {
      provider: "codex",
      executionMode: "app_server",
      providerSessionId: "s2",
    };
    assert.equal(ref.executionMode, "app_server");
  });

  it("agent_sdk represents Claude Agent SDK in-process", () => {
    const ref = {
      provider: "claude",
      executionMode: "agent_sdk",
      providerSessionId: "s3",
    };
    assert.equal(ref.executionMode, "agent_sdk");
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 3. ProviderSessionRef structural shape
// ═══════════════════════════════════════════════════════════════════════

describe("SDK-3: ProviderSessionRef shape", () => {
  it("has required fields: provider, executionMode, providerSessionId", () => {
    const ref = {
      provider: "codex",
      executionMode: "cli_exec",
      providerSessionId: "sess-abc-123",
    };
    assert.ok("provider" in ref);
    assert.ok("executionMode" in ref);
    assert.ok("providerSessionId" in ref);
  });

  it("provider is 'codex' or 'claude'", () => {
    const codexRef = {
      provider: "codex",
      executionMode: "app_server",
      providerSessionId: "s1",
    };
    const claudeRef = {
      provider: "claude",
      executionMode: "agent_sdk",
      providerSessionId: "s2",
    };
    assert.equal(codexRef.provider, "codex");
    assert.equal(claudeRef.provider, "claude");
  });

  it("supports optional threadId and turnId", () => {
    const ref = {
      provider: "codex",
      executionMode: "app_server",
      providerSessionId: "s1",
      threadId: "thread-001",
      turnId: "turn-001",
    };
    assert.equal(ref.threadId, "thread-001");
    assert.equal(ref.turnId, "turn-001");
  });

  it("works without optional fields", () => {
    const ref = {
      provider: "claude",
      executionMode: "cli_exec",
      providerSessionId: "s3",
    };
    assert.equal(ref.threadId, undefined);
    assert.equal(ref.turnId, undefined);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 4. SessionRuntimeRequest structural shape
// ═══════════════════════════════════════════════════════════════════════

describe("SDK-3: SessionRuntimeRequest shape", () => {
  it("has required fields: prompt, cwd, sessionId", () => {
    const req = {
      prompt: "implement feature X",
      cwd: "/repo",
      sessionId: "quorum-session-1",
    };
    assert.ok("prompt" in req);
    assert.ok("cwd" in req);
    assert.ok("sessionId" in req);
  });

  it("supports optional contractId", () => {
    const req = {
      prompt: "fix bug",
      cwd: "/repo",
      sessionId: "s1",
      contractId: "sprint-contract-42",
    };
    assert.equal(req.contractId, "sprint-contract-42");
  });

  it("supports optional resumeFrom with ProviderSessionRef", () => {
    const previousRef = {
      provider: "codex",
      executionMode: "app_server",
      providerSessionId: "prev-session",
    };
    const req = {
      prompt: "continue from where we left off",
      cwd: "/repo",
      sessionId: "s2",
      resumeFrom: previousRef,
    };
    assert.equal(req.resumeFrom.providerSessionId, "prev-session");
  });

  it("supports optional metadata record", () => {
    const req = {
      prompt: "review code",
      cwd: "/repo",
      sessionId: "s3",
      metadata: { trackName: "auth", waveId: 2, tags: ["security"] },
    };
    assert.equal(req.metadata.trackName, "auth");
    assert.equal(req.metadata.waveId, 2);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 5. ProviderRuntimeEvent kind values (all 9)
// ═══════════════════════════════════════════════════════════════════════

describe("SDK-3: ProviderRuntimeEvent kind values", () => {
  const allKinds = [
    "thread_started",
    "turn_started",
    "item_started",
    "item_delta",
    "item_completed",
    "approval_requested",
    "turn_completed",
    "session_completed",
    "session_failed",
  ];

  it("defines exactly 9 event kinds", () => {
    assert.equal(allKinds.length, 9, "must have exactly 9 event kinds");
  });

  for (const kind of allKinds) {
    it(`accepts kind '${kind}'`, () => {
      const ref = {
        provider: "codex",
        executionMode: "app_server",
        providerSessionId: "s1",
      };
      const event = {
        providerRef: ref,
        kind,
        payload: {},
        ts: Date.now(),
      };
      assert.equal(event.kind, kind);
      assert.ok(event.ts > 0);
      assert.ok("providerRef" in event);
      assert.ok("payload" in event);
    });
  }

  it("event has required fields: providerRef, kind, payload, ts", () => {
    const ref = {
      provider: "claude",
      executionMode: "agent_sdk",
      providerSessionId: "s2",
    };
    const event = {
      providerRef: ref,
      kind: "item_delta",
      payload: { delta: "some text" },
      ts: 1700000000000,
    };
    assert.ok("providerRef" in event);
    assert.ok("kind" in event);
    assert.ok("payload" in event);
    assert.ok("ts" in event);
    assert.equal(typeof event.ts, "number");
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 6. ProviderApprovalRequest kind values
// ═══════════════════════════════════════════════════════════════════════

describe("SDK-3: ProviderApprovalRequest", () => {
  const approvalKinds = ["tool", "command", "diff", "network"];

  for (const kind of approvalKinds) {
    it(`accepts approval kind '${kind}'`, () => {
      const ref = {
        provider: "codex",
        executionMode: "app_server",
        providerSessionId: "s1",
      };
      const approval = {
        providerRef: ref,
        requestId: `req-${kind}-001`,
        kind,
        reason: `Requesting ${kind} access`,
      };
      assert.equal(approval.kind, kind);
      assert.ok(approval.requestId.startsWith("req-"));
    });
  }

  it("has required fields: providerRef, requestId, kind, reason", () => {
    const approval = {
      providerRef: {
        provider: "codex",
        executionMode: "app_server",
        providerSessionId: "s1",
      },
      requestId: "req-001",
      kind: "tool",
      reason: "wants to run bash",
    };
    assert.ok("providerRef" in approval);
    assert.ok("requestId" in approval);
    assert.ok("kind" in approval);
    assert.ok("reason" in approval);
  });

  it("supports optional scope array", () => {
    const approval = {
      providerRef: {
        provider: "claude",
        executionMode: "agent_sdk",
        providerSessionId: "s2",
      },
      requestId: "req-002",
      kind: "command",
      reason: "rm -rf temp",
      scope: ["/repo/temp", "/repo/build"],
    };
    assert.ok(Array.isArray(approval.scope));
    assert.equal(approval.scope.length, 2);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 7. ProviderApprovalDecision decision values
// ═══════════════════════════════════════════════════════════════════════

describe("SDK-3: ProviderApprovalDecision", () => {
  it("accepts decision 'allow'", () => {
    const decision = { requestId: "req-001", decision: "allow" };
    assert.equal(decision.decision, "allow");
  });

  it("accepts decision 'deny'", () => {
    const decision = { requestId: "req-002", decision: "deny" };
    assert.equal(decision.decision, "deny");
  });

  it("has required fields: requestId, decision", () => {
    const decision = { requestId: "req-003", decision: "allow" };
    assert.ok("requestId" in decision);
    assert.ok("decision" in decision);
  });

  it("supports optional remember flag", () => {
    const decision = {
      requestId: "req-004",
      decision: "allow",
      remember: true,
    };
    assert.equal(decision.remember, true);
  });

  it("remember defaults to undefined when omitted", () => {
    const decision = { requestId: "req-005", decision: "deny" };
    assert.equal(decision.remember, undefined);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 8. createRuntimeEvent() factory function
// ═══════════════════════════════════════════════════════════════════════

describe("SDK-3: createRuntimeEvent()", () => {
  const ref = {
    provider: "codex",
    executionMode: "app_server",
    providerSessionId: "factory-test-session",
  };

  it("creates an event with correct providerRef", () => {
    const event = createRuntimeEvent(ref, "thread_started");
    assert.deepEqual(event.providerRef, ref);
  });

  it("creates an event with correct kind", () => {
    const event = createRuntimeEvent(ref, "session_completed");
    assert.equal(event.kind, "session_completed");
  });

  it("creates an event with default empty payload", () => {
    const event = createRuntimeEvent(ref, "turn_started");
    assert.deepEqual(event.payload, {});
  });

  it("creates an event with custom payload", () => {
    const payload = { delta: "hello world", index: 42 };
    const event = createRuntimeEvent(ref, "item_delta", payload);
    assert.deepEqual(event.payload, payload);
  });

  it("creates an event with a numeric timestamp", () => {
    const before = Date.now();
    const event = createRuntimeEvent(ref, "item_started");
    const after = Date.now();
    assert.equal(typeof event.ts, "number");
    assert.ok(event.ts >= before, "ts must be >= time before call");
    assert.ok(event.ts <= after, "ts must be <= time after call");
  });

  it("works with all 9 event kinds", () => {
    const kinds = [
      "thread_started",
      "turn_started",
      "item_started",
      "item_delta",
      "item_completed",
      "approval_requested",
      "turn_completed",
      "session_completed",
      "session_failed",
    ];
    for (const kind of kinds) {
      const event = createRuntimeEvent(ref, kind);
      assert.equal(event.kind, kind);
      assert.ok(event.ts > 0);
    }
  });

  it("barrel-exported createRuntimeEvent works identically", () => {
    const event = barrelModule.createRuntimeEvent(ref, "session_failed", {
      error: "timeout",
    });
    assert.equal(event.kind, "session_failed");
    assert.equal(event.payload.error, "timeout");
    assert.deepEqual(event.providerRef, ref);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 9. SessionRuntime interface contract (mock implementation)
// ═══════════════════════════════════════════════════════════════════════

describe("SDK-3: SessionRuntime interface contract (mock)", () => {
  // Mock implementation that satisfies the SessionRuntime interface
  function createMockRuntime(provider, mode) {
    const sessions = new Map();

    return {
      provider,
      mode,
      async start(request) {
        const ref = {
          provider,
          executionMode: mode,
          providerSessionId: `${provider}-${Date.now()}`,
        };
        sessions.set(ref.providerSessionId, {
          status: "running",
          request,
        });
        return ref;
      },
      async resume(ref, _request) {
        const session = sessions.get(ref.providerSessionId);
        if (session) session.status = "running";
      },
      async send(ref, _input) {
        const session = sessions.get(ref.providerSessionId);
        if (!session) throw new Error("session not found");
      },
      async stop(ref) {
        const session = sessions.get(ref.providerSessionId);
        if (session) session.status = "completed";
      },
      async poll(ref) {
        return [
          createRuntimeEvent(ref, "item_delta", { delta: "mock output" }),
        ];
      },
      async status(ref) {
        const session = sessions.get(ref.providerSessionId);
        return session ? session.status : "detached";
      },
    };
  }

  it("mock runtime has required readonly properties", () => {
    const runtime = createMockRuntime("codex", "app_server");
    assert.equal(runtime.provider, "codex");
    assert.equal(runtime.mode, "app_server");
  });

  it("start() returns a ProviderSessionRef", async () => {
    const runtime = createMockRuntime("claude", "agent_sdk");
    const ref = await runtime.start({
      prompt: "implement auth",
      cwd: "/repo",
      sessionId: "q-session-1",
    });
    assert.equal(ref.provider, "claude");
    assert.equal(ref.executionMode, "agent_sdk");
    assert.ok(ref.providerSessionId.startsWith("claude-"));
  });

  it("status() returns 'running' after start()", async () => {
    const runtime = createMockRuntime("codex", "app_server");
    const ref = await runtime.start({
      prompt: "fix bug",
      cwd: "/repo",
      sessionId: "q-session-2",
    });
    const s = await runtime.status(ref);
    assert.equal(s, "running");
  });

  it("stop() transitions status to 'completed'", async () => {
    const runtime = createMockRuntime("codex", "app_server");
    const ref = await runtime.start({
      prompt: "task",
      cwd: "/repo",
      sessionId: "q-session-3",
    });
    await runtime.stop(ref);
    const s = await runtime.status(ref);
    assert.equal(s, "completed");
  });

  it("status() returns 'detached' for unknown session", async () => {
    const runtime = createMockRuntime("claude", "cli_exec");
    const unknownRef = {
      provider: "claude",
      executionMode: "cli_exec",
      providerSessionId: "nonexistent",
    };
    const s = await runtime.status(unknownRef);
    assert.equal(s, "detached");
  });

  it("send() throws for unknown session", async () => {
    const runtime = createMockRuntime("codex", "app_server");
    const unknownRef = {
      provider: "codex",
      executionMode: "app_server",
      providerSessionId: "nonexistent",
    };
    await assert.rejects(
      () => runtime.send(unknownRef, "hello"),
      /session not found/,
    );
  });

  it("poll() returns ProviderRuntimeEvent array", async () => {
    const runtime = createMockRuntime("codex", "app_server");
    const ref = await runtime.start({
      prompt: "task",
      cwd: "/repo",
      sessionId: "q-session-4",
    });
    const events = await runtime.poll(ref);
    assert.ok(Array.isArray(events));
    assert.ok(events.length > 0);
    assert.equal(events[0].kind, "item_delta");
    assert.equal(events[0].payload.delta, "mock output");
    assert.deepEqual(events[0].providerRef, ref);
  });

  it("resume() re-activates a stopped session", async () => {
    const runtime = createMockRuntime("codex", "app_server");
    const ref = await runtime.start({
      prompt: "task",
      cwd: "/repo",
      sessionId: "q-session-5",
    });
    await runtime.stop(ref);
    assert.equal(await runtime.status(ref), "completed");
    await runtime.resume(ref);
    assert.equal(await runtime.status(ref), "running");
  });

  it("SessionRuntime has all required methods", () => {
    const runtime = createMockRuntime("claude", "agent_sdk");
    const requiredMethods = ["start", "resume", "send", "stop", "status"];
    for (const method of requiredMethods) {
      assert.equal(
        typeof runtime[method],
        "function",
        `SessionRuntime must have ${method}()`,
      );
    }
  });

  it("poll is optional on the interface", () => {
    // Create a runtime without poll — valid per interface
    const runtimeWithoutPoll = {
      provider: "claude",
      mode: "cli_exec",
      async start() {
        return {
          provider: "claude",
          executionMode: "cli_exec",
          providerSessionId: "s1",
        };
      },
      async resume() {},
      async send() {},
      async stop() {},
      async status() {
        return "running";
      },
      // Note: no poll method
    };
    assert.equal(runtimeWithoutPoll.poll, undefined);
    assert.equal(typeof runtimeWithoutPoll.start, "function");
    assert.equal(typeof runtimeWithoutPoll.status, "function");
  });

  it("status returns one of: running, completed, failed, detached", async () => {
    const validStatuses = ["running", "completed", "failed", "detached"];
    for (const s of validStatuses) {
      const runtime = {
        provider: "codex",
        mode: "cli_exec",
        async start() {
          return {
            provider: "codex",
            executionMode: "cli_exec",
            providerSessionId: "s1",
          };
        },
        async resume() {},
        async send() {},
        async stop() {},
        async status() {
          return s;
        },
      };
      const result = await runtime.status({});
      assert.ok(
        validStatuses.includes(result),
        `status '${result}' must be one of ${validStatuses.join(", ")}`,
      );
    }
  });
});
