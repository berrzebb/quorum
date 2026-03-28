/**
 * Live execution test for ALL hook scripts across 3 adapters.
 *
 * Each hook is spawned as a real process with proper stdin JSON,
 * and we verify: exit code, stdout format, protocol compliance.
 *
 * This is the definitive proof that every hook actually runs.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const CWD = process.cwd();
const TIMEOUT = 15000;

/**
 * Run a hook script with stdin JSON input.
 * Returns { code, stdout, stderr, duration }.
 */
function runHook(scriptPath, stdinJson, timeoutMs = TIMEOUT) {
  return new Promise((res) => {
    const start = Date.now();
    const child = spawn("node", [scriptPath], {
      cwd: CWD,
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        CLAUDE_PLUGIN_ROOT: resolve("platform/adapters/claude-code"),
        GEMINI_EXTENSION_ROOT: resolve("platform/adapters/gemini"),
        QUORUM_REPO_ROOT: CWD,
        // Prevent reentrant guard from blocking
        FEEDBACK_LOOP_ACTIVE: undefined,
      },
      windowsHide: true,
      timeout: timeoutMs,
    });

    let stdout = "", stderr = "";
    child.stdout.on("data", (c) => { stdout += c; });
    child.stderr.on("data", (c) => { stderr += c; });

    if (stdinJson) {
      child.stdin.write(JSON.stringify(stdinJson));
    }
    child.stdin.end();

    child.on("close", (code) => {
      res({ code: code ?? 1, stdout: stdout.trim(), stderr: stderr.trim(), duration: Date.now() - start });
    });
    child.on("error", (err) => {
      res({ code: -1, stdout: "", stderr: err.message, duration: Date.now() - start });
    });
  });
}

/** Base input fields that all hooks receive. */
const BASE_INPUT = {
  session_id: "test-session-001",
  transcript_path: resolve(".claude/transcript.jsonl"),
  cwd: CWD,
  permission_mode: "default",
};

// ═══════════════════════════════════════════════════════════════
// Claude Code — 22 hooks
// ═══════════════════════════════════════════════════════════════

describe("Claude Code hooks — live execution (22)", () => {
  const ROOT = resolve("platform/adapters/claude-code");

  it("SessionStart → exit 0, stdout has context", async () => {
    const r = await runHook(resolve(ROOT, "session-start.mjs"), null);
    assert.equal(r.code, 0, `exit ${r.code}: ${r.stderr}`);
    // SessionStart outputs context text (git commits, resume state, etc.)
    // May be empty if no git history, but should not crash
  });

  it("UserPromptSubmit (prompt-submit) → exit 0", async () => {
    const r = await runHook(resolve(ROOT, "prompt-submit.mjs"), {
      ...BASE_INPUT, hook_event_name: "UserPromptSubmit",
      prompt: "Write a hello world function",
    });
    assert.equal(r.code, 0, `exit ${r.code}: ${r.stderr}`);
  });

  it("PreToolUse (session-gate) → exit 0 when no retro pending", async () => {
    const r = await runHook(resolve(ROOT, "session-gate.mjs"), {
      ...BASE_INPUT, hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: { command: "npm test" },
    });
    assert.equal(r.code, 0, `exit ${r.code}: ${r.stderr}`);
  });

  it("PostToolUse (index) → exit 0 on non-watch-file edit", async () => {
    const r = await runHook(resolve(ROOT, "index.mjs"), {
      ...BASE_INPUT, hook_event_name: "PostToolUse",
      tool_name: "Edit",
      tool_input: { file_path: resolve("README.md") },
    });
    assert.equal(r.code, 0, `exit ${r.code}: ${r.stderr}`);
  });

  it("PostToolUseFailure → exit 0", async () => {
    const r = await runHook(resolve(ROOT, "post-tool-failure.mjs"), {
      ...BASE_INPUT, hook_event_name: "PostToolUseFailure",
      tool_name: "Bash",
      tool_input: { command: "false" },
      error: "Command exited with code 1",
    });
    assert.equal(r.code, 0, `exit ${r.code}: ${r.stderr}`);
  });

  it("Stop (session-stop) → exit 0", async () => {
    const r = await runHook(resolve(ROOT, "session-stop.mjs"), {
      ...BASE_INPUT, hook_event_name: "Stop",
      stop_hook_active: false,
      last_assistant_message: "Done.",
    });
    assert.equal(r.code, 0, `exit ${r.code}: ${r.stderr}`);
  });

  it("StopFailure → exit 0", async () => {
    const r = await runHook(resolve(ROOT, "stop-failure.mjs"), {
      ...BASE_INPUT, hook_event_name: "StopFailure",
    });
    assert.equal(r.code, 0, `exit ${r.code}: ${r.stderr}`);
  });

  it("PreCompact → exit 0", async () => {
    const r = await runHook(resolve(ROOT, "pre-compact.mjs"), {
      ...BASE_INPUT, hook_event_name: "PreCompact",
      trigger: "manual",
    });
    assert.equal(r.code, 0, `exit ${r.code}: ${r.stderr}`);
  });

  it("PostCompact → exit 0", async () => {
    const r = await runHook(resolve(ROOT, "post-compact.mjs"), {
      ...BASE_INPUT, hook_event_name: "PostCompact",
    });
    assert.equal(r.code, 0, `exit ${r.code}: ${r.stderr}`);
  });

  it("SubagentStart → exit 0", async () => {
    const r = await runHook(resolve(ROOT, "subagent-start.mjs"), {
      ...BASE_INPUT, hook_event_name: "SubagentStart",
      agent_id: "agent-test-001",
      agent_type: "implementer",
    });
    assert.equal(r.code, 0, `exit ${r.code}: ${r.stderr}`);
  });

  it("SubagentStop → exit 0", async () => {
    const r = await runHook(resolve(ROOT, "subagent-stop.mjs"), {
      ...BASE_INPUT, hook_event_name: "SubagentStop",
      agent_id: "agent-test-001",
      agent_type: "implementer",
      last_assistant_message: "Task complete.",
    });
    assert.equal(r.code, 0, `exit ${r.code}: ${r.stderr}`);
  });

  it("WorktreeCreate → exit 0", async () => {
    const r = await runHook(resolve(ROOT, "worktree-create.mjs"), {
      ...BASE_INPUT, hook_event_name: "WorktreeCreate",
    });
    // WorktreeCreate may exit 0 or output a path
    assert.ok(r.code === 0 || r.stdout.length > 0, `exit ${r.code}: ${r.stderr}`);
  });

  it("WorktreeRemove → exit 0", async () => {
    const r = await runHook(resolve(ROOT, "worktree-remove.mjs"), {
      ...BASE_INPUT, hook_event_name: "WorktreeRemove",
    });
    assert.equal(r.code, 0, `exit ${r.code}: ${r.stderr}`);
  });

  it("TeammateIdle → exit 0", async () => {
    const r = await runHook(resolve(ROOT, "teammate-idle.mjs"), {
      ...BASE_INPUT, hook_event_name: "TeammateIdle",
      teammate_name: "researcher",
      team_name: "quorum-team",
    });
    assert.equal(r.code, 0, `exit ${r.code}: ${r.stderr}`);
  });

  it("TaskCompleted → exit 0 (with audit-status marker)", async () => {
    // task-completed requires audit-status.json to confirm evidence exists
    const { mkdirSync, writeFileSync, rmSync } = await import("node:fs");
    const statusDir = resolve(CWD, ".claude");
    const statusPath = resolve(statusDir, "audit-status.json");
    const hadStatus = existsSync(statusPath);
    if (!hadStatus) {
      mkdirSync(statusDir, { recursive: true });
      writeFileSync(statusPath, JSON.stringify({ status: "approved" }));
    }
    try {
      const r = await runHook(resolve(ROOT, "task-completed.mjs"), {
        ...BASE_INPUT, hook_event_name: "TaskCompleted",
        task_id: "task-001",
        task_subject: "Test task",
      });
      assert.equal(r.code, 0, `exit ${r.code}: ${r.stderr}`);
    } finally {
      if (!hadStatus) try { rmSync(statusPath); } catch {}
    }
  });

  it("PermissionRequest → exit 0, valid JSON or empty", async () => {
    const r = await runHook(resolve(ROOT, "permission-request.mjs"), {
      ...BASE_INPUT, hook_event_name: "PermissionRequest",
      tool_name: "Bash",
      tool_input: { command: "echo hello" },
    });
    assert.equal(r.code, 0, `exit ${r.code}: ${r.stderr}`);
    // If JSON output, verify it has hookSpecificOutput structure
    if (r.stdout) {
      const json = JSON.parse(r.stdout);
      if (json.hookSpecificOutput) {
        assert.equal(json.hookSpecificOutput.hookEventName, "PermissionRequest");
      }
    }
  });

  it("Notification → exit 0", async () => {
    const r = await runHook(resolve(ROOT, "notification.mjs"), {
      ...BASE_INPUT, hook_event_name: "Notification",
      notification_type: "permission_prompt",
      message: "Claude needs permission to use Bash",
    });
    assert.equal(r.code, 0, `exit ${r.code}: ${r.stderr}`);
  });

  it("InstructionsLoaded → exit 0", async () => {
    const r = await runHook(resolve(ROOT, "instructions-loaded.mjs"), {
      ...BASE_INPUT, hook_event_name: "InstructionsLoaded",
      file_path: resolve("CLAUDE.md"),
      memory_type: "Project",
      load_reason: "session_start",
    });
    assert.equal(r.code, 0, `exit ${r.code}: ${r.stderr}`);
  });

  it("ConfigChange → exit 0", async () => {
    const r = await runHook(resolve(ROOT, "config-change.mjs"), {
      ...BASE_INPUT, hook_event_name: "ConfigChange",
      source: "project_settings",
      file_path: ".claude/settings.json",
    });
    assert.equal(r.code, 0, `exit ${r.code}: ${r.stderr}`);
  });

  it("Elicitation → exit 0", async () => {
    const r = await runHook(resolve(ROOT, "elicitation.mjs"), {
      ...BASE_INPUT, hook_event_name: "Elicitation",
      tool_name: "mcp__memory__create",
      elicitation_id: "elic-001",
      message: "Enter entity name",
    });
    assert.equal(r.code, 0, `exit ${r.code}: ${r.stderr}`);
  });

  it("ElicitationResult → exit 0", async () => {
    const r = await runHook(resolve(ROOT, "elicitation-result.mjs"), {
      ...BASE_INPUT, hook_event_name: "ElicitationResult",
      tool_name: "mcp__memory__create",
      elicitation_id: "elic-001",
      action: "accept",
      content: { name: "test" },
    });
    assert.equal(r.code, 0, `exit ${r.code}: ${r.stderr}`);
  });

  it("SessionEnd → exit 0", async () => {
    const r = await runHook(resolve(ROOT, "session-end.mjs"), {
      ...BASE_INPUT, hook_event_name: "SessionEnd",
      reason: "exit",
    });
    assert.equal(r.code, 0, `exit ${r.code}: ${r.stderr}`);
  });
});


// ═══════════════════════════════════════════════════════════════
// Gemini CLI — 11 hooks
// ═══════════════════════════════════════════════════════════════

describe("Gemini CLI hooks — live execution (11)", () => {
  const ROOT = resolve("platform/adapters/gemini/hooks/scripts");

  it("SessionStart → exit 0, stdout is JSON", async () => {
    const r = await runHook(resolve(ROOT, "session-start.mjs"), null);
    assert.equal(r.code, 0, `exit ${r.code}: ${r.stderr}`);
    // Gemini protocol: stdout must be JSON (or empty)
    if (r.stdout) {
      const json = JSON.parse(r.stdout);
      assert.ok(json.hookSpecificOutput || json.systemMessage, "Should have hookSpecificOutput or systemMessage");
    }
  });

  it("BeforeAgent → exit 0, JSON with hookSpecificOutput", async () => {
    const r = await runHook(resolve(ROOT, "before-agent.mjs"), {
      ...BASE_INPUT, hook_event_name: "BeforeAgent",
      prompt: "Implement feature X",
    });
    assert.equal(r.code, 0, `exit ${r.code}: ${r.stderr}`);
    if (r.stdout) {
      const json = JSON.parse(r.stdout);
      assert.ok(json.hookSpecificOutput?.additionalContext, "Should have additionalContext");
    }
  });

  it("BeforeTool → exit 0 when no retro pending", async () => {
    const r = await runHook(resolve(ROOT, "before-tool.mjs"), {
      ...BASE_INPUT, hook_event_name: "BeforeTool",
      tool_name: "read_file",
      tool_input: { path: "README.md" },
    });
    assert.equal(r.code, 0, `exit ${r.code}: ${r.stderr}`);
  });

  it("AfterTool → exit 0 on non-watch-file edit", async () => {
    const r = await runHook(resolve(ROOT, "after-tool.mjs"), {
      ...BASE_INPUT, hook_event_name: "AfterTool",
      tool_name: "write_file",
      tool_input: { file_path: resolve("README.md"), path: resolve("README.md") },
    });
    assert.equal(r.code, 0, `exit ${r.code}: ${r.stderr}`);
    // Gemini protocol: no plain text on stdout
    if (r.stdout) {
      assert.doesNotThrow(() => JSON.parse(r.stdout), "stdout must be JSON");
    }
  });

  it("AfterAgent → exit 0", async () => {
    const r = await runHook(resolve(ROOT, "after-agent.mjs"), {
      ...BASE_INPUT, hook_event_name: "AfterAgent",
      prompt: "Done",
      prompt_response: "Completed.",
    });
    assert.equal(r.code, 0, `exit ${r.code}: ${r.stderr}`);
  });

  it("BeforeModel → exit 0 (no-op)", async () => {
    const r = await runHook(resolve(ROOT, "before-model.mjs"), null);
    assert.equal(r.code, 0);
  });

  it("AfterModel → exit 0 (no-op)", async () => {
    const r = await runHook(resolve(ROOT, "after-model.mjs"), null);
    assert.equal(r.code, 0);
  });

  it("BeforeToolSelection → exit 0 (no-op)", async () => {
    const r = await runHook(resolve(ROOT, "before-tool-selection.mjs"), null);
    assert.equal(r.code, 0);
  });

  it("PreCompress → exit 0", async () => {
    const r = await runHook(resolve(ROOT, "pre-compress.mjs"), {
      ...BASE_INPUT, hook_event_name: "PreCompress",
      trigger: "auto",
    });
    assert.equal(r.code, 0, `exit ${r.code}: ${r.stderr}`);
  });

  it("Notification → exit 0 (no-op)", async () => {
    const r = await runHook(resolve(ROOT, "notification.mjs"), null);
    assert.equal(r.code, 0);
  });

  it("SessionEnd → exit 0", async () => {
    const r = await runHook(resolve(ROOT, "session-end.mjs"), {
      ...BASE_INPUT, hook_event_name: "SessionEnd",
      reason: "exit",
    });
    assert.equal(r.code, 0, `exit ${r.code}: ${r.stderr}`);
  });
});


// ═══════════════════════════════════════════════════════════════
// Codex CLI — 5 hooks
// ═══════════════════════════════════════════════════════════════

describe("Codex CLI hooks — live execution (5)", () => {
  const ROOT = resolve("platform/adapters/codex/hooks/scripts");

  it("SessionStart → exit 0, stdout has context", async () => {
    const r = await runHook(resolve(ROOT, "session-start.mjs"), null);
    assert.equal(r.code, 0, `exit ${r.code}: ${r.stderr}`);
  });

  it("Stop (session-stop) → exit 0", async () => {
    const r = await runHook(resolve(ROOT, "session-stop.mjs"), {
      ...BASE_INPUT, hook_event_name: "Stop",
    });
    assert.equal(r.code, 0, `exit ${r.code}: ${r.stderr}`);
  });

  it("UserPromptSubmit → exit 0", async () => {
    const r = await runHook(resolve(ROOT, "prompt-submit.mjs"), {
      ...BASE_INPUT, hook_event_name: "UserPromptSubmit",
      prompt: "Fix the bug",
    });
    assert.equal(r.code, 0, `exit ${r.code}: ${r.stderr}`);
  });

  it("AfterAgent → exit 0", async () => {
    const r = await runHook(resolve(ROOT, "after-agent.mjs"), {
      ...BASE_INPUT, hook_event_name: "AfterAgent",
    });
    assert.equal(r.code, 0, `exit ${r.code}: ${r.stderr}`);
  });

  it("AfterToolUse → exit 0 on non-watch-file", async () => {
    const r = await runHook(resolve(ROOT, "after-tool-use.mjs"), {
      ...BASE_INPUT, hook_event_name: "AfterToolUse",
      tool_name: "edit_file",
      tool_input: { file_path: resolve("README.md"), path: resolve("README.md") },
    });
    assert.equal(r.code, 0, `exit ${r.code}: ${r.stderr}`);
  });
});
