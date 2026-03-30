/**
 * Tests for platform/adapters/shared/hook-runner, hook-loader, hook-bridge.
 *
 * Ported from SoulFlow HookRunner with quorum adaptations.
 */

import { describe, it, before, after, mock } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ─── hook-runner ───────────────────────────────────────────────────
import {
  interpolateEnv,
  parseHookJson,
  runCommandHook,
  HookRunner,
} from "../platform/adapters/shared/hook-runner.mjs";

// ─── hook-loader ───────────────────────────────────────────────────
import {
  loadHooksFromFile,
  hooksConfigFromJson,
  mergeHooksConfigs,
} from "../platform/adapters/shared/hook-loader.mjs";

// ─── hook-bridge ───────────────────────────────────────────────────
import {
  hookRunnerToPreToolHook,
  hookRunnerToPostToolHook,
  hookRunnerToAuditGate,
  buildHookInput,
} from "../platform/adapters/shared/hook-bridge.mjs";


// ═══════════════════════════════════════════════════════════════════
// interpolateEnv
// ═══════════════════════════════════════════════════════════════════

describe("interpolateEnv", () => {
  it("replaces $VAR syntax", () => {
    process.env.__TEST_HOOK_VAR = "hello";
    assert.equal(interpolateEnv("say $__TEST_HOOK_VAR"), "say hello");
    delete process.env.__TEST_HOOK_VAR;
  });

  it("replaces ${VAR} syntax", () => {
    process.env.__TEST_HOOK_BRACED = "world";
    assert.equal(interpolateEnv("say ${__TEST_HOOK_BRACED}!"), "say world!");
    delete process.env.__TEST_HOOK_BRACED;
  });

  it("replaces missing vars with empty string", () => {
    delete process.env.__NONEXISTENT_VAR_HOOK_TEST;
    assert.equal(interpolateEnv("$__NONEXISTENT_VAR_HOOK_TEST"), "");
  });

  it("handles mixed formats", () => {
    process.env.__A = "1";
    process.env.__B = "2";
    assert.equal(interpolateEnv("$__A and ${__B}"), "1 and 2");
    delete process.env.__A;
    delete process.env.__B;
  });
});


// ═══════════════════════════════════════════════════════════════════
// parseHookJson
// ═══════════════════════════════════════════════════════════════════

describe("parseHookJson", () => {
  it("parses valid JSON with all fields", () => {
    const result = parseHookJson(JSON.stringify({
      decision: "deny",
      reason: "blocked",
      updated_input: { x: 1 },
      additional_context: "extra",
    }));
    assert.equal(result.decision, "deny");
    assert.equal(result.reason, "blocked");
    assert.deepEqual(result.updated_input, { x: 1 });
    assert.equal(result.additional_context, "extra");
  });

  it("returns null for empty string", () => {
    assert.equal(parseHookJson(""), null);
    assert.equal(parseHookJson("  "), null);
  });

  it("returns null for invalid JSON", () => {
    assert.equal(parseHookJson("not json"), null);
  });

  it("handles partial fields", () => {
    const result = parseHookJson(JSON.stringify({ decision: "allow" }));
    assert.equal(result.decision, "allow");
    assert.equal(result.reason, undefined);
    assert.equal(result.updated_input, undefined);
  });

  it("ignores non-string reason", () => {
    const result = parseHookJson(JSON.stringify({ decision: "allow", reason: 42 }));
    assert.equal(result.reason, undefined);
  });
});


// ═══════════════════════════════════════════════════════════════════
// runCommandHook (integration — spawns real process)
// ═══════════════════════════════════════════════════════════════════

describe("runCommandHook", () => {
  const cwd = process.cwd();

  it("exit 0 with JSON stdout → parsed output", async () => {
    const cmd = `node -e "process.stdout.write(JSON.stringify({ decision: 'allow', reason: 'ok' }))"`;
    const result = await runCommandHook(cmd, { hook_event_name: "test" }, cwd, 5000);
    assert.equal(result.decision, "allow");
    assert.equal(result.reason, "ok");
  });

  it("exit 0 with empty stdout → { decision: allow }", async () => {
    const cmd = `node -e "process.exit(0)"`;
    const result = await runCommandHook(cmd, { hook_event_name: "test" }, cwd, 5000);
    assert.equal(result.decision, "allow");
  });

  it("exit 2 → deny", async () => {
    const cmd = `node -e "process.stdout.write(JSON.stringify({ reason: 'no' })); process.exit(2)"`;
    const result = await runCommandHook(cmd, { hook_event_name: "test" }, cwd, 5000);
    assert.equal(result.decision, "deny");
    assert.equal(result.reason, "no");
  });

  it("exit 1 → ignore", async () => {
    const cmd = `node -e "process.exit(1)"`;
    const result = await runCommandHook(cmd, { hook_event_name: "test" }, cwd, 5000);
    assert.equal(result.decision, "ignore");
    assert.match(result.reason, /code 1/);
  });

  it("receives HookInput on stdin", async () => {
    const cmd = `node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const o=JSON.parse(d);process.stdout.write(JSON.stringify({decision:'allow',reason:o.hook_event_name}))})"`;
    const result = await runCommandHook(cmd, { hook_event_name: "PostToolUse", tool_name: "Edit" }, cwd, 5000);
    assert.equal(result.decision, "allow");
    assert.equal(result.reason, "PostToolUse");
  });

  it("env interpolation in command", async () => {
    process.env.__HOOK_TEST_CMD = "node";
    const cmd = `$__HOOK_TEST_CMD -e "process.stdout.write(JSON.stringify({decision:'allow'}))"`;
    const result = await runCommandHook(cmd, { hook_event_name: "test" }, cwd, 5000);
    assert.equal(result.decision, "allow");
    delete process.env.__HOOK_TEST_CMD;
  });
});


// ═══════════════════════════════════════════════════════════════════
// HookRunner
// ═══════════════════════════════════════════════════════════════════

describe("HookRunner", () => {
  const cwd = process.cwd();

  it("constructor loads config", () => {
    const runner = new HookRunner(cwd, {
      hooks: {
        PreToolUse: [
          { name: "gate", event: "PreToolUse", handler: { type: "command", command: "echo ok" } },
        ],
      },
    });
    assert.equal(runner.has("PreToolUse"), true);
    assert.equal(runner.has("PostToolUse"), false);
  });

  it("filters disabled hooks", () => {
    const runner = new HookRunner(cwd, {
      hooks: {
        PreToolUse: [
          { name: "active", event: "PreToolUse", handler: { type: "command", command: "echo ok" } },
          { name: "off", event: "PreToolUse", handler: { type: "command", command: "echo no" }, disabled: true },
        ],
      },
    });
    const list = runner.listHooks();
    assert.equal(list.length, 1);
    assert.equal(list[0].name, "active");
  });

  it("add() appends hook", () => {
    const runner = new HookRunner(cwd);
    assert.equal(runner.has("Stop"), false);
    runner.add({ name: "cleanup", event: "Stop", handler: { type: "command", command: "echo bye" } });
    assert.equal(runner.has("Stop"), true);
  });

  it("add() ignores disabled", () => {
    const runner = new HookRunner(cwd);
    runner.add({ name: "off", event: "Stop", handler: { type: "command", command: "echo" }, disabled: true });
    assert.equal(runner.has("Stop"), false);
  });

  it("fire() returns empty for unregistered event", async () => {
    const runner = new HookRunner(cwd);
    const results = await runner.fire("NonExistent", { hook_event_name: "NonExistent" });
    assert.deepEqual(results, []);
  });

  it("fire() runs command hook and returns result", async () => {
    const runner = new HookRunner(cwd, {
      hooks: {
        test: [
          {
            name: "echo-hook",
            event: "test",
            handler: {
              type: "command",
              command: `node -e "process.stdout.write(JSON.stringify({decision:'allow',reason:'from-hook'}))"`,
            },
          },
        ],
      },
    });

    const results = await runner.fire("test", { hook_event_name: "test" });
    assert.equal(results.length, 1);
    assert.equal(results[0].hook_name, "echo-hook");
    assert.equal(results[0].output.decision, "allow");
    assert.equal(results[0].output.reason, "from-hook");
    assert.ok(results[0].duration_ms >= 0);
  });

  it("fire() stops on first deny", async () => {
    const runner = new HookRunner(cwd, {
      hooks: {
        test: [
          {
            name: "deny-hook",
            event: "test",
            handler: { type: "command", command: `node -e "process.exit(2)"` },
          },
          {
            name: "never-reached",
            event: "test",
            handler: { type: "command", command: `node -e "process.exit(0)"` },
          },
        ],
      },
    });

    const results = await runner.fire("test", { hook_event_name: "test" });
    assert.equal(results.length, 1);
    assert.equal(results[0].hook_name, "deny-hook");
    assert.equal(results[0].output.decision, "deny");
  });

  it("fire() applies matcher filter", async () => {
    const runner = new HookRunner(cwd, {
      hooks: {
        PostToolUse: [
          {
            name: "edit-only",
            event: "PostToolUse",
            matcher: "Edit|Write",
            handler: {
              type: "command",
              command: `node -e "process.stdout.write(JSON.stringify({decision:'allow',reason:'matched'}))"`,
            },
          },
        ],
      },
    });

    // Non-matching tool → skipped
    const r1 = await runner.fire("PostToolUse", { hook_event_name: "PostToolUse", tool_name: "Bash" });
    assert.equal(r1.length, 0);

    // Matching tool → executed
    const r2 = await runner.fire("PostToolUse", { hook_event_name: "PostToolUse", tool_name: "Edit" });
    assert.equal(r2.length, 1);
    assert.equal(r2[0].output.reason, "matched");
  });

  it("fire() handles async hooks as fire-and-forget", async () => {
    const runner = new HookRunner(cwd, {
      hooks: {
        test: [
          {
            name: "async-hook",
            event: "test",
            async: true,
            handler: { type: "command", command: `node -e "setTimeout(()=>process.exit(0),50)"` },
          },
          {
            name: "sync-hook",
            event: "test",
            handler: {
              type: "command",
              command: `node -e "process.stdout.write(JSON.stringify({decision:'allow'}))"`,
            },
          },
        ],
      },
    });

    const results = await runner.fire("test", { hook_event_name: "test" });
    assert.equal(results.length, 2);
    assert.equal(results[0].hook_name, "async-hook");
    assert.equal(results[0].output.decision, "ignore"); // async → immediate ignore
    assert.equal(results[0].duration_ms, 0);
    assert.equal(results[1].hook_name, "sync-hook");
    assert.equal(results[1].output.decision, "allow");
  });

  it("listHooks() returns all registered hooks", () => {
    const runner = new HookRunner(cwd, {
      hooks: {
        PreToolUse: [
          { name: "gate1", event: "PreToolUse", handler: { type: "command", command: "echo" } },
        ],
        PostToolUse: [
          { name: "log1", event: "PostToolUse", handler: { type: "http", url: "http://localhost" } },
        ],
      },
    });
    const list = runner.listHooks();
    assert.equal(list.length, 2);
    assert.ok(list.some((h) => h.name === "gate1" && h.handlerType === "command"));
    assert.ok(list.some((h) => h.name === "log1" && h.handlerType === "http"));
  });
});


// ═══════════════════════════════════════════════════════════════════
// hook-loader
// ═══════════════════════════════════════════════════════════════════

describe("hook-loader", () => {
  let tmpDir;

  before(() => {
    tmpDir = join(tmpdir(), `quorum-hook-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  after(() => {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch (err) { console.warn("hook-runner cleanup failed:", err?.message ?? err); }
  });

  describe("loadHooksFromFile", () => {
    it("loads HOOK.md with YAML frontmatter", () => {
      const hookMd = `---
hooks:
  PreToolUse:
    - name: block-exec
      matcher: "exec|shell"
      handler:
        type: command
        command: "node check.js"
        timeout_ms: 5000
  PostToolUse:
    - name: log-tool
      handler:
        type: http
        url: "http://localhost:9090/log"
      async: true
---

# User-defined hooks

These hooks run during the quorum audit pipeline.
`;
      writeFileSync(join(tmpDir, "HOOK.md"), hookMd);
      const config = loadHooksFromFile(tmpDir);

      assert.ok(config.hooks.PreToolUse);
      assert.equal(config.hooks.PreToolUse.length, 1);
      assert.equal(config.hooks.PreToolUse[0].name, "block-exec");
      assert.equal(config.hooks.PreToolUse[0].matcher, "exec|shell");
      assert.equal(config.hooks.PreToolUse[0].handler.type, "command");
      assert.equal(config.hooks.PreToolUse[0].handler.command, "node check.js");
      assert.equal(config.hooks.PreToolUse[0].handler.timeout_ms, 5000);

      assert.ok(config.hooks.PostToolUse);
      assert.equal(config.hooks.PostToolUse.length, 1);
      assert.equal(config.hooks.PostToolUse[0].name, "log-tool");
      assert.equal(config.hooks.PostToolUse[0].handler.type, "http");
      assert.equal(config.hooks.PostToolUse[0].async, true);
    });

    it("returns empty for missing file", () => {
      const config = loadHooksFromFile(join(tmpDir, "nonexistent"));
      assert.deepEqual(config, { hooks: {} });
    });

    it("returns empty for file without frontmatter", () => {
      writeFileSync(join(tmpDir, "NO-FM.md"), "# No frontmatter\nJust text.");
      const config = loadHooksFromFile(tmpDir, "NO-FM.md");
      assert.deepEqual(config, { hooks: {} });
    });
  });

  describe("hooksConfigFromJson", () => {
    it("converts JSON config to HooksConfig", () => {
      const config = hooksConfigFromJson({
        hooks: {
          PreToolUse: [
            { name: "gate", matcher: "Bash", handler: { type: "command", command: "echo" } },
          ],
          SessionStart: [
            { name: "init", handler: { type: "command", command: "node init.js" }, async: true },
          ],
        },
      });

      assert.equal(config.hooks.PreToolUse.length, 1);
      assert.equal(config.hooks.PreToolUse[0].name, "gate");
      assert.equal(config.hooks.PreToolUse[0].matcher, "Bash");

      assert.equal(config.hooks.SessionStart.length, 1);
      assert.equal(config.hooks.SessionStart[0].async, true);
    });

    it("handles null/undefined", () => {
      assert.deepEqual(hooksConfigFromJson(null), { hooks: {} });
      assert.deepEqual(hooksConfigFromJson(undefined), { hooks: {} });
    });

    it("ignores non-array event values", () => {
      const config = hooksConfigFromJson({
        hooks: { PreToolUse: "not an array" },
      });
      assert.deepEqual(config, { hooks: {} });
    });
  });

  describe("mergeHooksConfigs", () => {
    it("merges multiple configs", () => {
      const a = {
        hooks: {
          PreToolUse: [{ name: "a1", event: "PreToolUse", handler: { type: "command", command: "echo a" } }],
        },
      };
      const b = {
        hooks: {
          PreToolUse: [{ name: "b1", event: "PreToolUse", handler: { type: "command", command: "echo b" } }],
          PostToolUse: [{ name: "b2", event: "PostToolUse", handler: { type: "http", url: "http://x" } }],
        },
      };

      const merged = mergeHooksConfigs(a, b);
      assert.equal(merged.hooks.PreToolUse.length, 2);
      assert.equal(merged.hooks.PostToolUse.length, 1);
    });

    it("skips null configs", () => {
      const a = {
        hooks: { test: [{ name: "x", event: "test", handler: { type: "command", command: "echo" } }] },
      };
      const merged = mergeHooksConfigs(null, a, undefined);
      assert.equal(merged.hooks.test.length, 1);
    });
  });
});


// ═══════════════════════════════════════════════════════════════════
// hook-bridge
// ═══════════════════════════════════════════════════════════════════

describe("hook-bridge", () => {
  const cwd = process.cwd();

  describe("hookRunnerToPreToolHook", () => {
    it("returns allow when no hooks registered", async () => {
      const runner = new HookRunner(cwd);
      const gate = hookRunnerToPreToolHook(runner);
      const result = await gate("Bash", {});
      assert.equal(result.decision, "allow");
    });

    it("returns deny when hook denies", async () => {
      const runner = new HookRunner(cwd, {
        hooks: {
          PreToolUse: [{
            name: "block",
            event: "PreToolUse",
            handler: { type: "command", command: `node -e "process.exit(2)"` },
          }],
        },
      });
      const gate = hookRunnerToPreToolHook(runner);
      const result = await gate("Bash", {});
      assert.equal(result.decision, "deny");
    });

    it("returns updated_input when hook provides it", async () => {
      const runner = new HookRunner(cwd, {
        hooks: {
          PreToolUse: [{
            name: "modify",
            event: "PreToolUse",
            handler: {
              type: "command",
              command: `node -e "process.stdout.write(JSON.stringify({decision:'allow',updated_input:{patched:true}}))"`,
            },
          }],
        },
      });
      const gate = hookRunnerToPreToolHook(runner);
      const result = await gate("Edit", { file: "x.ts" });
      assert.equal(result.decision, "allow");
      assert.deepEqual(result.updated_input, { patched: true });
    });
  });

  describe("hookRunnerToPostToolHook", () => {
    it("fires PostToolUse event", async () => {
      let fired = false;
      const runner = new HookRunner(cwd, {
        hooks: {
          PostToolUse: [{
            name: "logger",
            event: "PostToolUse",
            handler: {
              type: "command",
              command: `node -e "process.stdout.write(JSON.stringify({decision:'allow'}))"`,
            },
          }],
        },
      });
      const handler = hookRunnerToPostToolHook(runner, "session-1");
      // Should not throw
      await handler("Edit", { file: "x.ts" }, "ok");
    });

    it("fires PostToolUseFailure for errors", async () => {
      const runner = new HookRunner(cwd, {
        hooks: {
          PostToolUseFailure: [{
            name: "error-log",
            event: "PostToolUseFailure",
            handler: {
              type: "command",
              command: `node -e "process.stdout.write(JSON.stringify({decision:'allow'}))"`,
            },
          }],
        },
      });
      const handler = hookRunnerToPostToolHook(runner);
      await handler("Bash", { command: "rm" }, "error", undefined, true);
    });
  });

  describe("hookRunnerToAuditGate", () => {
    it("returns allow when no hooks", async () => {
      const runner = new HookRunner(cwd);
      const gate = hookRunnerToAuditGate(runner, "audit.submit");
      const result = await gate({ tier: "T2" });
      assert.equal(result.decision, "allow");
    });

    it("returns deny when hook blocks", async () => {
      const runner = new HookRunner(cwd, {
        hooks: {
          "audit.submit": [{
            name: "freeze",
            event: "audit.submit",
            handler: {
              type: "command",
              command: `node -e "process.stdout.write(JSON.stringify({decision:'deny',reason:'code freeze'}));process.exit(2)"`,
            },
          }],
        },
      });
      const gate = hookRunnerToAuditGate(runner, "audit.submit");
      const result = await gate();
      assert.equal(result.decision, "deny");
      assert.match(result.reason, /code freeze/);
    });

    it("collects additional_context from multiple hooks", async () => {
      const runner = new HookRunner(cwd, {
        hooks: {
          "audit.verdict": [
            {
              name: "ctx1",
              event: "audit.verdict",
              handler: {
                type: "command",
                command: `node -e "process.stdout.write(JSON.stringify({decision:'allow',additional_context:'note-1'}))"`,
              },
            },
            {
              name: "ctx2",
              event: "audit.verdict",
              handler: {
                type: "command",
                command: `node -e "process.stdout.write(JSON.stringify({decision:'allow',additional_context:'note-2'}))"`,
              },
            },
          ],
        },
      });
      const gate = hookRunnerToAuditGate(runner, "audit.verdict");
      const result = await gate();
      assert.equal(result.decision, "allow");
      assert.ok(result.additional_context.includes("note-1"));
      assert.ok(result.additional_context.includes("note-2"));
    });
  });

  describe("buildHookInput", () => {
    it("builds canonical HookInput", () => {
      const input = buildHookInput({
        event: "PostToolUse",
        sessionId: "s1",
        cwd: "/repo",
        toolName: "Edit",
        toolInput: { file: "x.ts" },
        toolOutput: "ok",
      });
      assert.equal(input.hook_event_name, "PostToolUse");
      assert.equal(input.session_id, "s1");
      assert.equal(input.tool_name, "Edit");
      assert.deepEqual(input.tool_input, { file: "x.ts" });
    });

    it("handles minimal input", () => {
      const input = buildHookInput({ event: "SessionStart" });
      assert.equal(input.hook_event_name, "SessionStart");
      assert.equal(input.tool_name, undefined);
    });
  });
});


// ═══════════════════════════════════════════════════════════════════
// bridge.mjs integration — initHookRunner / checkHookGate / fireHook
// ═══════════════════════════════════════════════════════════════════

describe("bridge.mjs HookRunner integration", () => {
  const hookScript = join(process.cwd(), "tests", "fixtures", "mock-hook.mjs");

  it("initHookRunner loads hooks from config", async () => {
    const bridge = await import("../platform/core/bridge.mjs");
    await bridge.init(process.cwd());

    const runner = await bridge.initHookRunner(process.cwd(), {
      "audit.submit": [
        { name: "gate", handler: { type: "command", command: `node ${hookScript}` } },
      ],
    });

    assert.ok(runner);
    assert.equal(runner.has("audit.submit"), true);
    bridge.close();
  });

  it("checkHookGate allow — receives additional_context from hook stdin", async () => {
    const bridge = await import("../platform/core/bridge.mjs");
    await bridge.init(process.cwd());
    await bridge.initHookRunner(process.cwd(), {
      "audit.submit": [
        { name: "gate", handler: { type: "command", command: `node ${hookScript}` } },
      ],
    });

    const result = await bridge.checkHookGate("audit.submit", {
      metadata: { provider: "claude-code", freeze: false },
    });

    assert.equal(result.allowed, true);
    assert.ok(result.additional_context?.includes("claude-code"));
    bridge.close();
  });

  it("checkHookGate deny — hook exits with code 2", async () => {
    const bridge = await import("../platform/core/bridge.mjs");
    await bridge.init(process.cwd());
    await bridge.initHookRunner(process.cwd(), {
      "audit.submit": [
        { name: "gate", handler: { type: "command", command: `node ${hookScript}` } },
      ],
    });

    const result = await bridge.checkHookGate("audit.submit", {
      metadata: { provider: "claude-code", freeze: true },
    });

    assert.equal(result.allowed, false);
    assert.ok(result.reason?.includes("code freeze"));
    bridge.close();
  });

  it("fireHook fail-safe — no crash when HookRunner not initialized", async () => {
    const bridge = await import("../platform/core/bridge.mjs");
    bridge.close(); // ensure clean state

    const results = await bridge.fireHook("audit.submit");
    assert.deepEqual(results, []);

    const gate = await bridge.checkHookGate("audit.submit");
    assert.equal(gate.allowed, true);
  });

  it("unregistered events pass through", async () => {
    const bridge = await import("../platform/core/bridge.mjs");
    await bridge.init(process.cwd());
    await bridge.initHookRunner(process.cwd(), {});

    const gate = await bridge.checkHookGate("nonexistent.event");
    assert.equal(gate.allowed, true);
    bridge.close();
  });
});
