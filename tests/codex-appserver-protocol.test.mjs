#!/usr/bin/env node
/**
 * Codex App Server Protocol Types + Client Tests
 *
 * Tests protocol constants, client lifecycle, error paths,
 * notification dispatch, and buffer handling — no real Codex binary needed.
 *
 * Run: node --test tests/codex-appserver-protocol.test.mjs
 */

import { strict as assert } from "node:assert";
import { describe, it, before, after } from "node:test";
import { createServer, createConnection } from "node:net";
import { spawn } from "node:child_process";
import { resolve } from "node:path";

const { CODEX_NOTIFICATIONS, CODEX_METHODS } = await import(
  "../dist/platform/providers/codex/app-server/protocol.js"
);
const { CodexAppServerClient } = await import(
  "../dist/platform/providers/codex/app-server/client.js"
);

// ═══ 1. Protocol constants ══════════════════════════════════════════════

describe("Protocol constants", () => {
  it("CODEX_NOTIFICATIONS has all 9 notification methods", () => {
    const expected = [
      "thread/started",
      "turn/started",
      "item/started",
      "item/delta",
      "item/completed",
      "turn/completed",
      "approval/requested",
      "session/completed",
      "session/failed",
    ];
    const actual = Object.values(CODEX_NOTIFICATIONS);
    assert.equal(actual.length, 9);
    for (const method of expected) {
      assert.ok(actual.includes(method), `Missing notification: ${method}`);
    }
  });

  it("CODEX_METHODS has all 6 client methods", () => {
    const expected = [
      "initialize",
      "thread/create",
      "thread/sendInput",
      "approval/response",
      "thread/stop",
      "thread/status",
    ];
    const actual = Object.values(CODEX_METHODS);
    assert.equal(actual.length, 6);
    for (const method of expected) {
      assert.ok(actual.includes(method), `Missing method: ${method}`);
    }
  });

  it("CODEX_NOTIFICATIONS keys match expected naming", () => {
    assert.equal(CODEX_NOTIFICATIONS.THREAD_STARTED, "thread/started");
    assert.equal(CODEX_NOTIFICATIONS.TURN_STARTED, "turn/started");
    assert.equal(CODEX_NOTIFICATIONS.ITEM_STARTED, "item/started");
    assert.equal(CODEX_NOTIFICATIONS.ITEM_DELTA, "item/delta");
    assert.equal(CODEX_NOTIFICATIONS.ITEM_COMPLETED, "item/completed");
    assert.equal(CODEX_NOTIFICATIONS.TURN_COMPLETED, "turn/completed");
    assert.equal(CODEX_NOTIFICATIONS.APPROVAL_REQUESTED, "approval/requested");
    assert.equal(CODEX_NOTIFICATIONS.SESSION_COMPLETED, "session/completed");
    assert.equal(CODEX_NOTIFICATIONS.SESSION_FAILED, "session/failed");
  });

  it("CODEX_METHODS keys match expected naming", () => {
    assert.equal(CODEX_METHODS.INITIALIZE, "initialize");
    assert.equal(CODEX_METHODS.CREATE_THREAD, "thread/create");
    assert.equal(CODEX_METHODS.SEND_INPUT, "thread/sendInput");
    assert.equal(CODEX_METHODS.APPROVAL_RESPONSE, "approval/response");
    assert.equal(CODEX_METHODS.STOP_THREAD, "thread/stop");
    assert.equal(CODEX_METHODS.THREAD_STATUS, "thread/status");
  });
});

// ═══ 2. Client instantiation ════════════════════════════════════════════

describe("CodexAppServerClient instantiation", () => {
  it("creates with default args", () => {
    const client = new CodexAppServerClient();
    assert.ok(client);
    assert.equal(client.connected, false);
  });

  it("creates with custom binary and args", () => {
    const client = new CodexAppServerClient("/usr/bin/codex", ["--app-server", "--verbose"], 60_000);
    assert.ok(client);
    assert.equal(client.connected, false);
  });

  it("connected is false initially", () => {
    const client = new CodexAppServerClient();
    assert.equal(client.connected, false);
  });
});

// ═══ 3. Error paths ═════════════════════════════════════════════════════

describe("CodexAppServerClient error paths", () => {
  it("connect() fails gracefully when binary not found", async () => {
    const client = new CodexAppServerClient("nonexistent-codex-binary-xyz-12345");

    // Suppress unhandled error event
    client.on("error", () => {});

    await assert.rejects(
      () => client.connect(),
      (err) => {
        // Should get an error (either spawn error or "Not connected")
        assert.ok(err instanceof Error);
        return true;
      },
    );

    assert.equal(client.connected, false);
  });

  it("disconnect() is idempotent", async () => {
    const client = new CodexAppServerClient();
    await client.disconnect();
    await client.disconnect();
    await client.disconnect();
    assert.equal(client.connected, false);
  });

  it("createThread() throws when not connected", async () => {
    const client = new CodexAppServerClient();

    await assert.rejects(
      () => client.createThread({ prompt: "test", cwd: "/tmp" }),
      { message: "Not connected to App Server" },
    );
  });

  it("sendInput() throws when not connected", async () => {
    const client = new CodexAppServerClient();

    await assert.rejects(
      () => client.sendInput({ threadId: "t1", input: "hello" }),
      { message: "Not connected to App Server" },
    );
  });

  it("respondApproval() throws when not connected", async () => {
    const client = new CodexAppServerClient();

    await assert.rejects(
      () => client.respondApproval({ requestId: "r1", decision: "allow" }),
      { message: "Not connected to App Server" },
    );
  });

  it("stopThread() throws when not connected", async () => {
    const client = new CodexAppServerClient();

    await assert.rejects(
      () => client.stopThread({ threadId: "t1" }),
      { message: "Not connected to App Server" },
    );
  });

  it("threadStatus() throws when not connected", async () => {
    const client = new CodexAppServerClient();

    await assert.rejects(
      () => client.threadStatus({ threadId: "t1" }),
      { message: "Not connected to App Server" },
    );
  });
});

// ═══ 4. Mock subprocess tests ═══════════════════════════════════════════
//
// Use a tiny Node.js script as a fake App Server to test message flow.

/**
 * Spawn a Node.js script that acts as a mock App Server:
 * reads NDJSON from stdin, writes NDJSON responses to stdout.
 */
function createMockServerScript(behavior) {
  return `
    process.stdin.setEncoding("utf-8");
    let buffer = "";
    process.stdin.on("data", (chunk) => {
      buffer += chunk;
      const lines = buffer.split("\\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          const behavior = ${JSON.stringify(behavior)};
          const handler = behavior[msg.method];
          if (handler === "timeout") {
            // Don't respond — let it timeout
            return;
          }
          if (handler === "error") {
            process.stdout.write(JSON.stringify({
              jsonrpc: "2.0",
              id: msg.id,
              error: { code: -32600, message: "Mock error" }
            }) + "\\n");
            return;
          }
          if (msg.method === "initialize") {
            process.stdout.write(JSON.stringify({
              jsonrpc: "2.0",
              id: msg.id,
              result: {
                serverName: "mock-codex",
                serverVersion: "0.0.1",
                capabilities: {}
              }
            }) + "\\n");
          } else if (msg.method === "thread/create") {
            process.stdout.write(JSON.stringify({
              jsonrpc: "2.0",
              id: msg.id,
              result: { threadId: "mock-thread-1" }
            }) + "\\n");
          } else if (msg.method === "thread/status") {
            process.stdout.write(JSON.stringify({
              jsonrpc: "2.0",
              id: msg.id,
              result: "running"
            }) + "\\n");
          } else {
            process.stdout.write(JSON.stringify({
              jsonrpc: "2.0",
              id: msg.id,
              result: null
            }) + "\\n");
          }
        } catch (e) { process.stderr.write("mock-server parse error: " + e + "\\n"); }
      }
    });
  `;
}

describe("CodexAppServerClient with mock server", () => {
  it("connects and initializes successfully", async () => {
    const client = new CodexAppServerClient(
      process.execPath,
      ["-e", createMockServerScript({})],
      5000,
    );
    client.on("error", () => {});

    const result = await client.connect();
    assert.equal(result.serverName, "mock-codex");
    assert.equal(result.serverVersion, "0.0.1");
    assert.equal(client.connected, true);

    await client.disconnect();
    assert.equal(client.connected, false);
  });

  it("connect() rejects if already connected", async () => {
    const client = new CodexAppServerClient(
      process.execPath,
      ["-e", createMockServerScript({})],
      5000,
    );
    client.on("error", () => {});

    await client.connect();
    assert.equal(client.connected, true);

    await assert.rejects(
      () => client.connect(),
      { message: "Already connected" },
    );

    await client.disconnect();
  });

  it("createThread returns ThreadRef", async () => {
    const client = new CodexAppServerClient(
      process.execPath,
      ["-e", createMockServerScript({})],
      5000,
    );
    client.on("error", () => {});

    await client.connect();
    const ref = await client.createThread({ prompt: "fix bug", cwd: "/tmp" });
    assert.equal(ref.threadId, "mock-thread-1");

    await client.disconnect();
  });

  it("threadStatus returns status string", async () => {
    const client = new CodexAppServerClient(
      process.execPath,
      ["-e", createMockServerScript({})],
      5000,
    );
    client.on("error", () => {});

    await client.connect();
    const status = await client.threadStatus({ threadId: "mock-thread-1" });
    assert.equal(status, "running");

    await client.disconnect();
  });

  it("sendInput resolves on success", async () => {
    const client = new CodexAppServerClient(
      process.execPath,
      ["-e", createMockServerScript({})],
      5000,
    );
    client.on("error", () => {});

    await client.connect();
    await client.sendInput({ threadId: "t1", input: "hello" });
    // No throw = success

    await client.disconnect();
  });

  it("respondApproval resolves on success", async () => {
    const client = new CodexAppServerClient(
      process.execPath,
      ["-e", createMockServerScript({})],
      5000,
    );
    client.on("error", () => {});

    await client.connect();
    await client.respondApproval({ requestId: "r1", decision: "allow" });

    await client.disconnect();
  });

  it("stopThread resolves on success", async () => {
    const client = new CodexAppServerClient(
      process.execPath,
      ["-e", createMockServerScript({})],
      5000,
    );
    client.on("error", () => {});

    await client.connect();
    await client.stopThread({ threadId: "t1" });

    await client.disconnect();
  });

  it("handles JSON-RPC error responses", async () => {
    const client = new CodexAppServerClient(
      process.execPath,
      ["-e", createMockServerScript({ "thread/create": "error" })],
      5000,
    );
    client.on("error", () => {});

    await client.connect();

    await assert.rejects(
      () => client.createThread({ prompt: "test", cwd: "/tmp" }),
      (err) => {
        assert.ok(err.message.includes("-32600"));
        assert.ok(err.message.includes("Mock error"));
        return true;
      },
    );

    await client.disconnect();
  });

  it("request timeout fires when server does not respond", async () => {
    const client = new CodexAppServerClient(
      process.execPath,
      ["-e", createMockServerScript({ "thread/create": "timeout" })],
      500, // 500ms timeout
    );
    client.on("error", () => {});

    await client.connect();

    await assert.rejects(
      () => client.createThread({ prompt: "slow", cwd: "/tmp" }),
      (err) => {
        assert.ok(err.message.includes("timed out"));
        return true;
      },
    );

    await client.disconnect();
  });
});

// ═══ 5. Notification handling ═══════════════════════════════════════════

describe("CodexAppServerClient notifications", () => {
  it("emits notification events for server-pushed messages", async () => {
    // Mock server that sends a notification after initialize
    const script = `
      process.stdin.setEncoding("utf-8");
      let buffer = "";
      process.stdin.on("data", (chunk) => {
        buffer += chunk;
        const lines = buffer.split("\\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const msg = JSON.parse(line);
            if (msg.method === "initialize") {
              process.stdout.write(JSON.stringify({
                jsonrpc: "2.0",
                id: msg.id,
                result: { serverName: "mock", serverVersion: "1.0", capabilities: {} }
              }) + "\\n");
              // Push a notification after init response
              setTimeout(() => {
                process.stdout.write(JSON.stringify({
                  jsonrpc: "2.0",
                  method: "thread/started",
                  params: { threadId: "t-abc", createdAt: 1234567890 }
                }) + "\\n");
              }, 50);
            } else {
              process.stdout.write(JSON.stringify({
                jsonrpc: "2.0",
                id: msg.id,
                result: null
              }) + "\\n");
            }
          } catch (e) { process.stderr.write("mock-server parse error: " + e + "\\n"); }
        }
      });
    `;

    const client = new CodexAppServerClient(
      process.execPath,
      ["-e", script],
      5000,
    );
    client.on("error", () => {});

    const notifications = [];
    client.on("notification", (n) => notifications.push(n));

    const threadStartedParams = [];
    client.on("thread/started", (p) => threadStartedParams.push(p));

    await client.connect();

    // Wait for the notification to arrive
    await new Promise((r) => setTimeout(r, 200));

    assert.equal(notifications.length, 1);
    assert.equal(notifications[0].method, "thread/started");
    assert.equal(notifications[0].params.threadId, "t-abc");

    assert.equal(threadStartedParams.length, 1);
    assert.equal(threadStartedParams[0].threadId, "t-abc");
    assert.equal(threadStartedParams[0].createdAt, 1234567890);

    await client.disconnect();
  });

  it("emits server_request for server-initiated requests with id", async () => {
    const script = `
      process.stdin.setEncoding("utf-8");
      let buffer = "";
      process.stdin.on("data", (chunk) => {
        buffer += chunk;
        const lines = buffer.split("\\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const msg = JSON.parse(line);
            if (msg.method === "initialize") {
              process.stdout.write(JSON.stringify({
                jsonrpc: "2.0",
                id: msg.id,
                result: { serverName: "mock", serverVersion: "1.0", capabilities: {} }
              }) + "\\n");
              // Push a server-initiated request (has id + method)
              setTimeout(() => {
                process.stdout.write(JSON.stringify({
                  jsonrpc: "2.0",
                  id: "srv-1",
                  method: "approval/requested",
                  params: { requestId: "req-1", threadId: "t-1", kind: "tool", reason: "run npm" }
                }) + "\\n");
              }, 50);
            } else {
              process.stdout.write(JSON.stringify({
                jsonrpc: "2.0",
                id: msg.id,
                result: null
              }) + "\\n");
            }
          } catch (e) { process.stderr.write("mock-server parse error: " + e + "\\n"); }
        }
      });
    `;

    const client = new CodexAppServerClient(
      process.execPath,
      ["-e", script],
      5000,
    );
    client.on("error", () => {});

    const serverRequests = [];
    client.on("server_request", (r) => serverRequests.push(r));

    await client.connect();
    await new Promise((r) => setTimeout(r, 200));

    assert.equal(serverRequests.length, 1);
    assert.equal(serverRequests[0].method, "approval/requested");
    assert.equal(serverRequests[0].params.requestId, "req-1");
    assert.equal(serverRequests[0].params.kind, "tool");

    await client.disconnect();
  });
});

// ═══ 6. Buffer handling ═════════════════════════════════════════════════

describe("CodexAppServerClient buffer handling", () => {
  it("handles partial NDJSON lines across data chunks", async () => {
    // Mock server that sends a response split across two chunks
    const script = `
      process.stdin.setEncoding("utf-8");
      let buffer = "";
      process.stdin.on("data", (chunk) => {
        buffer += chunk;
        const lines = buffer.split("\\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const msg = JSON.parse(line);
            if (msg.method === "initialize") {
              // Send response in two chunks with a small delay
              const resp = JSON.stringify({
                jsonrpc: "2.0",
                id: msg.id,
                result: { serverName: "chunked", serverVersion: "1.0", capabilities: {} }
              });
              const mid = Math.floor(resp.length / 2);
              process.stdout.write(resp.slice(0, mid));
              setTimeout(() => {
                process.stdout.write(resp.slice(mid) + "\\n");
              }, 30);
            }
          } catch (e) { process.stderr.write("mock-server parse error: " + e + "\\n"); }
        }
      });
    `;

    const client = new CodexAppServerClient(
      process.execPath,
      ["-e", script],
      5000,
    );
    client.on("error", () => {});

    const result = await client.connect();
    assert.equal(result.serverName, "chunked");

    await client.disconnect();
  });

  it("handles multiple messages in a single chunk", async () => {
    // Mock server that sends init response + notification in one write
    const script = `
      process.stdin.setEncoding("utf-8");
      let buffer = "";
      process.stdin.on("data", (chunk) => {
        buffer += chunk;
        const lines = buffer.split("\\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const msg = JSON.parse(line);
            if (msg.method === "initialize") {
              const resp = JSON.stringify({
                jsonrpc: "2.0",
                id: msg.id,
                result: { serverName: "multi", serverVersion: "1.0", capabilities: {} }
              });
              const notif = JSON.stringify({
                jsonrpc: "2.0",
                method: "item/delta",
                params: { threadId: "t1", turnId: "tu1", itemId: "i1", delta: "hello" }
              });
              // Write both in one chunk
              process.stdout.write(resp + "\\n" + notif + "\\n");
            }
          } catch (e) { process.stderr.write("mock-server parse error: " + e + "\\n"); }
        }
      });
    `;

    const client = new CodexAppServerClient(
      process.execPath,
      ["-e", script],
      5000,
    );
    client.on("error", () => {});

    const deltas = [];
    client.on("item/delta", (p) => deltas.push(p));

    const result = await client.connect();
    assert.equal(result.serverName, "multi");

    // Wait for notification processing
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(deltas.length, 1);
    assert.equal(deltas[0].delta, "hello");

    await client.disconnect();
  });

  it("emits parse_error for unparseable lines", async () => {
    const script = `
      process.stdin.setEncoding("utf-8");
      let buffer = "";
      process.stdin.on("data", (chunk) => {
        buffer += chunk;
        const lines = buffer.split("\\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const msg = JSON.parse(line);
            if (msg.method === "initialize") {
              process.stdout.write(JSON.stringify({
                jsonrpc: "2.0",
                id: msg.id,
                result: { serverName: "parse-err", serverVersion: "1.0", capabilities: {} }
              }) + "\\n");
              // Send garbage
              setTimeout(() => {
                process.stdout.write("THIS IS NOT JSON\\n");
              }, 50);
            }
          } catch (e) { process.stderr.write("mock-server parse error: " + e + "\\n"); }
        }
      });
    `;

    const client = new CodexAppServerClient(
      process.execPath,
      ["-e", script],
      5000,
    );
    client.on("error", () => {});

    const parseErrors = [];
    client.on("parse_error", (e) => parseErrors.push(e));

    await client.connect();
    await new Promise((r) => setTimeout(r, 200));

    assert.equal(parseErrors.length, 1);
    assert.ok(parseErrors[0].includes("THIS IS NOT JSON"));

    await client.disconnect();
  });
});

// ═══ 7. Process lifecycle ═══════════════════════════════════════════════

describe("CodexAppServerClient process lifecycle", () => {
  it("emits exit when subprocess terminates", async () => {
    const script = `
      process.stdin.setEncoding("utf-8");
      let buffer = "";
      process.stdin.on("data", (chunk) => {
        buffer += chunk;
        const lines = buffer.split("\\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const msg = JSON.parse(line);
            if (msg.method === "initialize") {
              process.stdout.write(JSON.stringify({
                jsonrpc: "2.0",
                id: msg.id,
                result: { serverName: "exit-test", serverVersion: "1.0", capabilities: {} }
              }) + "\\n");
              // Exit after 100ms
              setTimeout(() => process.exit(0), 100);
            }
          } catch (e) { process.stderr.write("mock-server parse error: " + e + "\\n"); }
        }
      });
    `;

    const client = new CodexAppServerClient(
      process.execPath,
      ["-e", script],
      5000,
    );
    client.on("error", () => {});

    const exitCodes = [];
    client.on("exit", (code) => exitCodes.push(code));

    await client.connect();
    assert.equal(client.connected, true);

    // Wait for exit
    await new Promise((r) => setTimeout(r, 300));

    assert.equal(exitCodes.length, 1);
    assert.equal(exitCodes[0], 0);
    assert.equal(client.connected, false);

    await client.disconnect(); // Should be idempotent
  });

  it("rejects pending requests when subprocess exits", async () => {
    const script = `
      process.stdin.setEncoding("utf-8");
      let buffer = "";
      let initDone = false;
      process.stdin.on("data", (chunk) => {
        buffer += chunk;
        const lines = buffer.split("\\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const msg = JSON.parse(line);
            if (msg.method === "initialize") {
              process.stdout.write(JSON.stringify({
                jsonrpc: "2.0",
                id: msg.id,
                result: { serverName: "crash-test", serverVersion: "1.0", capabilities: {} }
              }) + "\\n");
              initDone = true;
            } else if (initDone) {
              // Exit without responding
              process.exit(1);
            }
          } catch (e) { process.stderr.write("mock-server parse error: " + e + "\\n"); }
        }
      });
    `;

    const client = new CodexAppServerClient(
      process.execPath,
      ["-e", script],
      5000,
    );
    client.on("error", () => {});

    await client.connect();

    await assert.rejects(
      () => client.createThread({ prompt: "test", cwd: "/tmp" }),
      (err) => {
        assert.ok(err.message.includes("exited") || err.message.includes("code"));
        return true;
      },
    );

    await client.disconnect();
  });

  it("emits stderr output", async () => {
    const script = `
      process.stderr.write("debug info\\n");
      process.stdin.setEncoding("utf-8");
      let buffer = "";
      process.stdin.on("data", (chunk) => {
        buffer += chunk;
        const lines = buffer.split("\\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const msg = JSON.parse(line);
            if (msg.method === "initialize") {
              process.stdout.write(JSON.stringify({
                jsonrpc: "2.0",
                id: msg.id,
                result: { serverName: "stderr-test", serverVersion: "1.0", capabilities: {} }
              }) + "\\n");
            }
          } catch (e) { process.stderr.write("mock-server parse error: " + e + "\\n"); }
        }
      });
    `;

    const client = new CodexAppServerClient(
      process.execPath,
      ["-e", script],
      5000,
    );
    client.on("error", () => {});

    const stderrOutput = [];
    client.on("stderr", (s) => stderrOutput.push(s));

    await client.connect();
    await new Promise((r) => setTimeout(r, 100));

    assert.ok(stderrOutput.some((s) => s.includes("debug info")));

    await client.disconnect();
  });
});
