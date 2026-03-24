/**
 * Multi-model integration tests — verifies all 3 CLI adapters (Claude, Codex, Gemini)
 * work through the full pipeline: NDJSON parsing + HookRunner + ProcessMux + Consensus.
 *
 * Each model is simulated with a Node.js script that outputs real NDJSON wire format.
 * The test exercises: adapter parsing, cross-model consensus, and hook interception.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";

// ─── Modules under test ────────────────────────────────────────
import { NdjsonParser } from "../adapters/shared/ndjson-parser.mjs";
import { ClaudeCliAdapter, CodexCliAdapter, GeminiCliAdapter, createCliAdapter } from "../adapters/shared/cli-adapter.mjs";
import { HookRunner } from "../adapters/shared/hook-runner.mjs";
import { hookRunnerToPreToolHook, hookRunnerToAuditGate } from "../adapters/shared/hook-bridge.mjs";
import { JsonRpcClient } from "../adapters/shared/jsonrpc-client.mjs";
import { loadHooksFromFile, mergeHooksConfigs, hooksConfigFromJson } from "../adapters/shared/hook-loader.mjs";

// ═══════════════════════════════════════════════════════════════
// NDJSON wire format simulation scripts
// ═══════════════════════════════════════════════════════════════

/** Claude Code stream-json format */
const CLAUDE_NDJSON = [
  '{"type":"system","subtype":"init","session_id":"claude-session-001"}',
  '{"type":"assistant","message":{"content":[{"type":"text","text":"I reviewed the code. The implementation looks correct."}]}}',
  '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"npm test"}}]}}',
  '{"type":"assistant","message":{"content":[{"type":"tool_result","tool_use_id":"Bash","content":"42 tests passing"}]}}',
  '{"type":"assistant","message":{"content":[{"type":"text","text":"All tests pass. Changes approved."}]}}',
  '{"type":"result","result":"{\\"verdict\\":\\"approved\\",\\"codes\\":[],\\"summary\\":\\"All tests pass, code is clean.\\"}","usage":{"input_tokens":1200,"output_tokens":350}}',
].join("\n") + "\n";

/** Codex CLI exec --json format */
const CODEX_NDJSON = [
  '{"type":"thread.started","thread_id":"codex-thread-001"}',
  '{"type":"turn.started"}',
  '{"type":"item.started","item":{"type":"command_execution","command":"npm test"}}',
  '{"type":"item.completed","item":{"type":"command_execution","command":"npm test","aggregated_output":"42 tests passing","exit_code":0}}',
  '{"type":"item.completed","item":{"type":"agent_message","text":"I found a potential issue with error handling in bridge.mjs line 45. The catch block swallows errors silently."}}',
  '{"type":"turn.completed","usage":{"input_tokens":800,"output_tokens":250}}',
].join("\n") + "\n";

/** Gemini CLI stream-json format */
const GEMINI_NDJSON = [
  '{"type":"init","session_id":"gemini-session-001","model":"gemini-2.5-flash"}',
  '{"type":"message","role":"assistant","content":"Reviewing the submission as judge.","delta":true}',
  '{"type":"tool_use","tool_name":"read_file","tool_id":"t1","parameters":{"path":"core/bridge.mjs"}}',
  '{"type":"tool_result","tool_name":"read_file","tool_id":"t1","status":"success","output":"// bridge module content..."}',
  '{"type":"message","role":"assistant","content":" After weighing both perspectives, the code is approved with one suggestion.","delta":true}',
  '{"type":"result","stats":{"input_tokens":1500,"output_tokens":400}}',
].join("\n") + "\n";


// ═══════════════════════════════════════════════════════════════
// 1. CLI Adapter + NDJSON Parser — per-model wire format
// ═══════════════════════════════════════════════════════════════

describe("CLI Adapter wire format parsing", () => {
  describe("Claude Code (stream-json)", () => {
    it("parses full session: init → assistant → tool_use → result", () => {
      const adapter = new ClaudeCliAdapter();
      const parser = new NdjsonParser(adapter);
      const msgs = parser.feed(CLAUDE_NDJSON);

      // init is consumed internally (sets sessionId)
      assert.equal(adapter.sessionId, "claude-session-001");

      // Messages: assistant_chunk, tool_use, tool_result, assistant_chunk, complete
      const types = msgs.map((m) => m.type);
      assert.ok(types.includes("assistant_chunk"), "should have assistant_chunk");
      assert.ok(types.includes("tool_use"), "should have tool_use");
      assert.ok(types.includes("tool_result"), "should have tool_result");
      assert.ok(types.includes("complete"), "should have complete");

      const complete = msgs.find((m) => m.type === "complete");
      assert.ok(complete.result.includes("approved"));
      assert.equal(complete.usage.input, 1200);
      assert.equal(complete.usage.output, 350);
    });

    it("buildArgs generates correct flags", () => {
      const adapter = new ClaudeCliAdapter();
      const args = adapter.buildArgs({ model: "claude-opus-4-6", maxTurns: 5 });
      assert.ok(args.includes("-p"));
      assert.ok(args.includes("--output-format"));
      assert.ok(args.includes("--model"));
      assert.ok(args.includes("claude-opus-4-6"));
      assert.ok(args.includes("--max-turns"));
    });
  });

  describe("Codex CLI (exec --json)", () => {
    it("parses full session: thread → items → turn.completed", () => {
      const adapter = new CodexCliAdapter();
      const parser = new NdjsonParser(adapter);
      const msgs = parser.feed(CODEX_NDJSON);

      assert.equal(adapter.sessionId, "codex-thread-001");

      const types = msgs.map((m) => m.type);
      assert.ok(types.includes("tool_use"), "should have tool_use (command_execution)");
      assert.ok(types.includes("tool_result"), "should have tool_result");
      assert.ok(types.includes("assistant_chunk"), "should have assistant_chunk (agent_message)");
      assert.ok(types.includes("complete"), "should have complete (turn.completed)");

      const toolUse = msgs.find((m) => m.type === "tool_use");
      assert.equal(toolUse.tool, "shell");

      const complete = msgs.find((m) => m.type === "complete");
      assert.ok(complete.result.includes("error handling"));
      assert.equal(complete.usage.input, 800);
    });

    it("buildArgs includes exec --json and stdin flag", () => {
      const adapter = new CodexCliAdapter();
      const args = adapter.buildArgs({ model: "codex-mini" });
      assert.ok(args.includes("exec"));
      assert.ok(args.includes("--json"));
      assert.ok(args.includes("-"));
    });
  });

  describe("Gemini CLI (stream-json)", () => {
    it("parses full session: init → message → tool → result", () => {
      const adapter = new GeminiCliAdapter();
      const parser = new NdjsonParser(adapter);
      const msgs = parser.feed(GEMINI_NDJSON);

      assert.equal(adapter.sessionId, "gemini-session-001");

      const types = msgs.map((m) => m.type);
      assert.ok(types.includes("assistant_chunk"), "should have assistant_chunk (message)");
      assert.ok(types.includes("tool_use"), "should have tool_use");
      assert.ok(types.includes("tool_result"), "should have tool_result");
      assert.ok(types.includes("complete"), "should have complete (result)");

      const complete = msgs.find((m) => m.type === "complete");
      assert.ok(complete.result.includes("approved"));
      assert.equal(complete.usage.input, 1500);
    });

    it("accumulates assistant text across delta messages", () => {
      const adapter = new GeminiCliAdapter();
      const parser = new NdjsonParser(adapter);
      const msgs = parser.feed(GEMINI_NDJSON);

      const chunks = msgs.filter((m) => m.type === "assistant_chunk");
      assert.equal(chunks.length, 2);
      assert.ok(chunks[0].content.includes("Reviewing"));
      assert.ok(chunks[1].content.includes("weighing"));
    });

    it("buildArgs includes approval-mode yolo", () => {
      const adapter = new GeminiCliAdapter();
      const args = adapter.buildArgs({ model: "gemini-2.5-flash" });
      assert.ok(args.includes("--approval-mode"));
      assert.ok(args.includes("yolo"));
    });
  });

  describe("createCliAdapter factory", () => {
    it("creates correct adapter by name", () => {
      assert.ok(createCliAdapter("claude") instanceof ClaudeCliAdapter);
      assert.ok(createCliAdapter("codex") instanceof CodexCliAdapter);
      assert.ok(createCliAdapter("gemini") instanceof GeminiCliAdapter);
    });

    it("throws for unknown adapter", () => {
      assert.throws(() => createCliAdapter("unknown"), /Unknown CLI adapter/);
    });
  });
});


// ═══════════════════════════════════════════════════════════════
// 2. Cross-model consensus format compatibility
// ═══════════════════════════════════════════════════════════════

describe("Cross-model consensus protocol", () => {
  it("all 3 adapters produce compatible AgentOutputMessage types", () => {
    const adapters = [new ClaudeCliAdapter(), new CodexCliAdapter(), new GeminiCliAdapter()];
    const ndjsons = [CLAUDE_NDJSON, CODEX_NDJSON, GEMINI_NDJSON];
    const EXPECTED_TYPES = new Set(["assistant_chunk", "tool_use", "tool_result", "complete"]);

    for (let i = 0; i < 3; i++) {
      const parser = new NdjsonParser(adapters[i]);
      const msgs = parser.feed(ndjsons[i]);
      const types = new Set(msgs.map((m) => m.type));

      for (const expected of EXPECTED_TYPES) {
        assert.ok(types.has(expected), `${adapters[i].cli_id} should produce ${expected}`);
      }

      // All complete messages have result field
      const complete = msgs.find((m) => m.type === "complete");
      assert.ok(typeof complete.result === "string", `${adapters[i].cli_id} complete.result should be string`);

      // All complete messages have usage
      assert.ok(complete.usage, `${adapters[i].cli_id} should have usage`);
      assert.ok(typeof complete.usage.input === "number");
      assert.ok(typeof complete.usage.output === "number");
    }
  });

  it("deliberative consensus: advocate(claude) + devil(codex) + judge(gemini)", () => {
    const roles = {
      advocate: { adapter: new ClaudeCliAdapter(), ndjson: CLAUDE_NDJSON },
      devil: { adapter: new CodexCliAdapter(), ndjson: CODEX_NDJSON },
      judge: { adapter: new GeminiCliAdapter(), ndjson: GEMINI_NDJSON },
    };

    const verdicts = {};
    for (const [role, { adapter, ndjson }] of Object.entries(roles)) {
      const parser = new NdjsonParser(adapter);
      const msgs = parser.feed(ndjson);
      const complete = msgs.find((m) => m.type === "complete");
      verdicts[role] = complete.result;
    }

    // Advocate (Claude) approves
    assert.ok(verdicts.advocate.includes("approved"));
    // Devil's advocate (Codex) raises issue
    assert.ok(verdicts.devil.includes("error handling"));
    // Judge (Gemini) weighs and decides
    assert.ok(verdicts.judge.includes("approved"));
  });
});


// ═══════════════════════════════════════════════════════════════
// 3. HookRunner integration — hooks fire across all adapters
// ═══════════════════════════════════════════════════════════════

describe("HookRunner multi-model integration", () => {
  const cwd = process.cwd();

  it("pre-tool hook gates all 3 adapters uniformly", async () => {
    const runner = new HookRunner(cwd, {
      hooks: {
        PreToolUse: [{
          name: "block-dangerous",
          event: "PreToolUse",
          matcher: "Bash|shell|exec",
          handler: {
            type: "command",
            command: `node -e "process.stdout.write(JSON.stringify({decision:'deny',reason:'blocked by policy'}))"`,
          },
        }],
      },
    });

    const gate = hookRunnerToPreToolHook(runner, "test-session");

    // Claude: Bash → blocked
    const r1 = await gate("Bash", { command: "rm -rf /" });
    assert.equal(r1.decision, "deny");

    // Codex: shell → blocked
    const r2 = await gate("shell", { command: "rm -rf /" });
    assert.equal(r2.decision, "deny");

    // Gemini: read_file → allowed (no match)
    const r3 = await gate("read_file", { path: "x.ts" });
    assert.equal(r3.decision, "allow");
  });

  it("audit gate fires for quorum lifecycle events", async () => {
    const runner = new HookRunner(cwd, {
      hooks: {
        "audit.submit": [{
          name: "log-submit",
          event: "audit.submit",
          handler: {
            type: "command",
            command: `node -e "process.stdout.write(JSON.stringify({decision:'allow',additional_context:'tier=T3'}))"`,
          },
        }],
        "audit.verdict": [{
          name: "log-verdict",
          event: "audit.verdict",
          handler: {
            type: "command",
            command: `node -e "process.stdout.write(JSON.stringify({decision:'allow',additional_context:'approved by 3-model consensus'}))"`,
          },
        }],
      },
    });

    const submitGate = hookRunnerToAuditGate(runner, "audit.submit", "s1");
    const verdictGate = hookRunnerToAuditGate(runner, "audit.verdict", "s1");

    const r1 = await submitGate({ tier: "T3", score: 0.85 });
    assert.equal(r1.decision, "allow");
    assert.ok(r1.additional_context.includes("tier=T3"));

    const r2 = await verdictGate({ verdict: "approved" });
    assert.equal(r2.decision, "allow");
    assert.ok(r2.additional_context.includes("3-model consensus"));
  });

  it("HOOK.md user hooks merge with adapter hooks", () => {
    const adapterConfig = hooksConfigFromJson({
      hooks: {
        PostToolUse: [{ name: "audit-trigger", handler: { type: "command", command: "node audit.mjs" } }],
      },
    });

    const userConfig = hooksConfigFromJson({
      hooks: {
        PostToolUse: [{ name: "my-logger", handler: { type: "http", url: "http://localhost:9090/log" }, async: true }],
        PreToolUse: [{ name: "my-gate", handler: { type: "command", command: "node gate.mjs" } }],
      },
    });

    const merged = mergeHooksConfigs(adapterConfig, userConfig);
    assert.equal(merged.hooks.PostToolUse.length, 2); // adapter + user
    assert.equal(merged.hooks.PreToolUse.length, 1); // user only
    assert.equal(merged.hooks.PostToolUse[0].name, "audit-trigger");
    assert.equal(merged.hooks.PostToolUse[1].name, "my-logger");
    assert.equal(merged.hooks.PostToolUse[1].async, true);
  });
});


// ═══════════════════════════════════════════════════════════════
// 4. JsonRpcClient — Codex app-server protocol
// ═══════════════════════════════════════════════════════════════

describe("JsonRpcClient", () => {
  it("request/response lifecycle with mock server", async () => {
    // Mock JSON-RPC server: reads request from stdin, writes response to stdout
    const serverScript = `
      let buf = '';
      process.stdin.on('data', c => {
        buf += c;
        const lines = buf.split('\\n');
        buf = lines.pop() || '';
        for (const line of lines) {
          if (!line.trim()) continue;
          const req = JSON.parse(line);
          if (req.method === 'initialize') {
            process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: req.id, result: { ok: true } }) + '\\n');
          } else if (req.method === 'echo') {
            process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: req.id, result: req.params }) + '\\n');
          }
        }
      });
    `;

    const client = new JsonRpcClient({
      command: "node",
      args: ["-e", serverScript],
      requestTimeoutMs: 5000,
    });

    client.start();

    try {
      const initResult = await client.request("initialize", { clientInfo: { name: "quorum" } });
      assert.deepEqual(initResult, { ok: true });

      const echoResult = await client.request("echo", { message: "hello" });
      assert.deepEqual(echoResult, { message: "hello" });
    } finally {
      client.stop();
    }
  });

  it("handles server notifications", async () => {
    const serverScript = `
      let buf = '';
      process.stdin.on('data', c => {
        buf += c;
        const lines = buf.split('\\n');
        buf = lines.pop() || '';
        for (const line of lines) {
          if (!line.trim()) continue;
          const req = JSON.parse(line);
          if (req.method === 'start') {
            // Send notifications
            process.stdout.write(JSON.stringify({ jsonrpc: '2.0', method: 'progress', params: { pct: 50 } }) + '\\n');
            process.stdout.write(JSON.stringify({ jsonrpc: '2.0', method: 'progress', params: { pct: 100 } }) + '\\n');
            // Then respond
            process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: req.id, result: 'done' }) + '\\n');
          }
        }
      });
    `;

    const client = new JsonRpcClient({
      command: "node",
      args: ["-e", serverScript],
      requestTimeoutMs: 5000,
    });

    const notifications = [];
    client.on("notification", (n) => notifications.push(n));
    client.start();

    try {
      const result = await client.request("start");
      assert.equal(result, "done");

      // Wait a tick for notification processing
      await new Promise((r) => setTimeout(r, 50));
      assert.ok(notifications.length >= 1);
      assert.equal(notifications[0].method, "progress");
    } finally {
      client.stop();
    }
  });

  it("handles server-initiated requests (bidirectional)", async () => {
    // Server receives 'run' request → asks client for approval → waits for response → responds to 'run'
    const serverScript = `
      let buf = '';
      let clientReqId = null;
      process.stdin.on('data', c => {
        buf += c;
        const lines = buf.split('\\n');
        buf = lines.pop() || '';
        for (const line of lines) {
          if (!line.trim()) continue;
          const msg = JSON.parse(line);
          if (msg.method === 'run' && msg.id) {
            clientReqId = msg.id;
            process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: 'srv-1', method: 'requestApproval', params: { action: 'delete' } }) + '\\n');
          } else if (msg.id === 'srv-1' && msg.result !== undefined) {
            process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: clientReqId, result: { approved: msg.result } }) + '\\n');
          }
        }
      });
    `;

    const client = new JsonRpcClient({
      command: "node",
      args: ["-e", serverScript],
      requestTimeoutMs: 5000,
    });

    const serverReqs = [];
    client.on("server_request", (req) => {
      serverReqs.push(req);
      if (req.method === "requestApproval") {
        client.respond(req.id, "accept");
      }
    });

    client.start();

    try {
      const result = await client.request("run", { task: "audit" });
      assert.deepEqual(result, { approved: "accept" });
      assert.ok(serverReqs.some((r) => r.method === "requestApproval"));
    } finally {
      client.stop();
    }
  });

  it("rejects pending on process exit", async () => {
    const client = new JsonRpcClient({
      command: "node",
      args: ["-e", "setTimeout(() => process.exit(0), 100)"],
      requestTimeoutMs: 5000,
    });

    client.start();

    try {
      await client.request("willFail");
      assert.fail("should have thrown");
    } catch (err) {
      assert.ok(err.message.includes("exit") || err.message.includes("timeout"));
    }
  });
});


// ═══════════════════════════════════════════════════════════════
// 5. Live process integration — spawn + NDJSON parse
// ═══════════════════════════════════════════════════════════════

describe("Live process → NDJSON → CliAdapter pipeline", () => {
  let tmpDir;

  before(() => {
    tmpDir = join(tmpdir(), `quorum-multi-model-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });

    // Create mock CLI scripts that output real NDJSON
    writeFileSync(join(tmpDir, "mock-claude.mjs"), `
      process.stdout.write(${JSON.stringify(CLAUDE_NDJSON)});
      process.exit(0);
    `);

    writeFileSync(join(tmpDir, "mock-codex.mjs"), `
      process.stdout.write(${JSON.stringify(CODEX_NDJSON)});
      process.exit(0);
    `);

    writeFileSync(join(tmpDir, "mock-gemini.mjs"), `
      process.stdout.write(${JSON.stringify(GEMINI_NDJSON)});
      process.exit(0);
    `);
  });

  after(() => {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ok */ }
  });

  /**
   * Spawn a mock CLI process, collect NDJSON output, parse through adapter.
   * @param {string} script — mock script path
   * @param {import("../adapters/shared/cli-adapter.mjs").ClaudeCliAdapter|import("../adapters/shared/cli-adapter.mjs").CodexCliAdapter|import("../adapters/shared/cli-adapter.mjs").GeminiCliAdapter} adapter
   * @returns {Promise<import("../adapters/shared/ndjson-parser.mjs").AgentOutputMessage[]>}
   */
  function runMockCli(script, adapter) {
    return new Promise((resolve, reject) => {
      const parser = new NdjsonParser(adapter);
      const allMsgs = [];

      const child = spawn("node", [script], {
        cwd: tmpDir,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });

      child.stdout.on("data", (chunk) => {
        allMsgs.push(...parser.feed(chunk.toString()));
      });

      child.on("close", (code) => {
        allMsgs.push(...parser.flush());
        resolve(allMsgs);
      });

      child.on("error", reject);
      setTimeout(() => reject(new Error("mock cli timeout")), 10000);
    });
  }

  it("Claude mock → ClaudeCliAdapter → complete with verdict", async () => {
    const adapter = new ClaudeCliAdapter();
    const msgs = await runMockCli(join(tmpDir, "mock-claude.mjs"), adapter);
    assert.equal(adapter.sessionId, "claude-session-001");
    const complete = msgs.find((m) => m.type === "complete");
    assert.ok(complete);
    assert.ok(complete.result.includes("approved"));
  });

  it("Codex mock → CodexCliAdapter → complete with findings", async () => {
    const adapter = new CodexCliAdapter();
    const msgs = await runMockCli(join(tmpDir, "mock-codex.mjs"), adapter);
    assert.equal(adapter.sessionId, "codex-thread-001");
    const complete = msgs.find((m) => m.type === "complete");
    assert.ok(complete);
    assert.ok(complete.result.includes("error handling"));
  });

  it("Gemini mock → GeminiCliAdapter → complete with judgment", async () => {
    const adapter = new GeminiCliAdapter();
    const msgs = await runMockCli(join(tmpDir, "mock-gemini.mjs"), adapter);
    assert.equal(adapter.sessionId, "gemini-session-001");
    const complete = msgs.find((m) => m.type === "complete");
    assert.ok(complete);
    assert.ok(complete.result.includes("approved"));
  });

  it("3-model deliberative consensus: spawn all → collect → verdict", async () => {
    const models = [
      { role: "advocate", script: join(tmpDir, "mock-claude.mjs"), adapter: new ClaudeCliAdapter() },
      { role: "devil", script: join(tmpDir, "mock-codex.mjs"), adapter: new CodexCliAdapter() },
      { role: "judge", script: join(tmpDir, "mock-gemini.mjs"), adapter: new GeminiCliAdapter() },
    ];

    // Spawn all 3 in parallel (simulates ProcessMux.spawn for each)
    const results = await Promise.all(
      models.map(async ({ role, script, adapter }) => {
        const msgs = await runMockCli(script, adapter);
        const complete = msgs.find((m) => m.type === "complete");
        return {
          role,
          provider: adapter.cli_id,
          sessionId: adapter.sessionId,
          result: complete?.result ?? "",
          usage: complete?.usage,
          messageCount: msgs.length,
        };
      }),
    );

    // All 3 models completed
    assert.equal(results.length, 3);
    for (const r of results) {
      assert.ok(r.sessionId, `${r.role} should have sessionId`);
      assert.ok(r.result.length > 0, `${r.role} should have result`);
      assert.ok(r.usage, `${r.role} should have usage`);
      assert.ok(r.messageCount >= 2, `${r.role} should have multiple messages`);
    }

    // Role-specific checks
    const advocate = results.find((r) => r.role === "advocate");
    const devil = results.find((r) => r.role === "devil");
    const judge = results.find((r) => r.role === "judge");

    assert.equal(advocate.provider, "claude");
    assert.equal(devil.provider, "codex");
    assert.equal(judge.provider, "gemini");

    // Total tokens consumed across all 3 models
    const totalInput = results.reduce((sum, r) => sum + (r.usage?.input ?? 0), 0);
    const totalOutput = results.reduce((sum, r) => sum + (r.usage?.output ?? 0), 0);
    assert.ok(totalInput > 0, "should have total input tokens");
    assert.ok(totalOutput > 0, "should have total output tokens");
  });
});


// ═══════════════════════════════════════════════════════════════
// 6. Full pipeline — HookRunner + CLI + Consensus
// ═══════════════════════════════════════════════════════════════

describe("Full pipeline: HookRunner → CliAdapter → Consensus", () => {
  const cwd = process.cwd();

  it("pre-audit hook → 3 model spawn → verdict aggregation", async () => {
    // Step 1: Pre-audit hook check (user-defined)
    const runner = new HookRunner(cwd, {
      hooks: {
        "audit.submit": [{
          name: "check-freeze",
          event: "audit.submit",
          handler: {
            type: "command",
            command: `node -e "process.stdout.write(JSON.stringify({decision:'allow',additional_context:'no freeze active'}))"`,
          },
        }],
      },
    });

    const submitGate = hookRunnerToAuditGate(runner, "audit.submit");
    const preCheck = await submitGate({ tier: "T3", score: 0.85 });
    assert.equal(preCheck.decision, "allow");

    // Step 2: Parse each model's output
    const adapters = {
      advocate: new ClaudeCliAdapter(),
      devil: new CodexCliAdapter(),
      judge: new GeminiCliAdapter(),
    };

    const parsers = {};
    const modelResults = {};
    for (const [role, adapter] of Object.entries(adapters)) {
      parsers[role] = new NdjsonParser(adapter);
    }

    // Feed NDJSON (simulates receiving from ProcessMux.capture())
    const modelMsgs = {
      advocate: parsers.advocate.feed(CLAUDE_NDJSON),
      devil: parsers.devil.feed(CODEX_NDJSON),
      judge: parsers.judge.feed(GEMINI_NDJSON),
    };

    for (const [role, msgs] of Object.entries(modelMsgs)) {
      const complete = msgs.find((m) => m.type === "complete");
      modelResults[role] = { result: complete?.result ?? "", usage: complete?.usage };
    }

    // Step 3: Aggregate verdict
    const allApproved = Object.values(modelResults).every((r) => r.result.includes("approved"));
    // In this test: advocate approves, devil raises concerns (doesn't say "approved"), judge approves
    // Devil's output: "error handling in bridge.mjs" — doesn't contain "approved"
    assert.ok(!allApproved, "devil should raise concerns (not unconditional approve)");

    // Majority vote: 2/3 approve → consensus reached
    const approvedCount = Object.values(modelResults).filter((r) => r.result.includes("approved")).length;
    assert.equal(approvedCount, 2, "2 of 3 models should approve");

    // Step 4: Post-verdict hook
    const verdictRunner = new HookRunner(cwd, {
      hooks: {
        "audit.verdict": [{
          name: "log-verdict",
          event: "audit.verdict",
          handler: {
            type: "command",
            command: `node -e "process.stdout.write(JSON.stringify({decision:'allow',additional_context:'majority approved'}))"`,
          },
        }],
      },
    });

    const verdictGate = hookRunnerToAuditGate(verdictRunner, "audit.verdict");
    const postCheck = await verdictGate({ verdict: "approved", majority: approvedCount });
    assert.equal(postCheck.decision, "allow");
    assert.ok(postCheck.additional_context.includes("majority approved"));
  });
});
