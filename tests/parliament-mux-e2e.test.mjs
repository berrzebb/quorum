/**
 * Parliament Mux E2E tests — real psmux + real CLI spawn.
 * Skips if psmux not available or claude not installed.
 * Tests the actual pipeline: spawn → send prompt → poll → parse.
 */
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function hasPsmux() {
  try {
    return spawnSync("psmux", ["version"], { encoding: "utf8", timeout: 3000 }).status === 0;
  } catch (err) { console.warn("psmux detection failed:", err?.message ?? err); return false; }
}

function hasClaude() {
  try {
    return spawnSync("claude", ["--version"], { encoding: "utf8", timeout: 5000 }).status === 0;
  } catch (err) { console.warn("claude detection failed:", err?.message ?? err); return false; }
}

const SKIP = !hasPsmux();
const SKIP_CLAUDE = !hasClaude();

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

describe("psmux E2E", { skip: SKIP ? "psmux not available" : false }, () => {
  it("spawn + send-keys + capture-pane lifecycle", async () => {
    const name = `quorum-e2e-${Date.now()}`;
    const marker = `e2e-output-${Date.now()}`;

    spawnSync("psmux", ["new", "-s", name, "-d"], { encoding: "utf8" });

    // pwsh needs 3+ seconds to initialize on Windows
    await sleep(3000);

    spawnSync("psmux", ["send-keys", "-t", name, `echo ${marker}`, "Enter"]);
    await sleep(2000);

    const cap = spawnSync("psmux", ["capture-pane", "-t", name, "-p", "-S", "-30"], { encoding: "utf8" });
    assert.equal(cap.status, 0);
    assert.ok(cap.stdout.includes(marker), `capture should contain '${marker}', got: ${cap.stdout.slice(0, 300)}`);

    spawnSync("psmux", ["kill-session", "-t", name]);
  });

  it("cmd /c pipe via send-keys works", async () => {
    const name = `quorum-e2e-pipe-${Date.now()}`;
    const marker = `pipe-test-${Date.now()}`;
    const promptFile = join(tmpdir(), `quorum-e2e-prompt-${Date.now()}.txt`);
    writeFileSync(promptFile, marker, "utf8");

    spawnSync("psmux", ["new", "-s", name, "-d"]);
    await sleep(3000);

    const escapedPath = promptFile.replace(/\//g, "\\");
    spawnSync("psmux", ["send-keys", "-t", name, `cmd /c "type ${escapedPath}"`, "Enter"]);
    await sleep(2000);

    const cap = spawnSync("psmux", ["capture-pane", "-t", name, "-p", "-S", "-30"], { encoding: "utf8" });
    assert.ok(cap.stdout.includes(marker), `pipe output should contain '${marker}', got: ${cap.stdout.slice(0, 300)}`);

    spawnSync("psmux", ["kill-session", "-t", name]);
    try { rmSync(promptFile); } catch (err) { console.warn("prompt file cleanup failed:", err?.message ?? err); }
  });

  describe("claude -p via psmux", { skip: SKIP_CLAUDE ? "claude not installed" : false }, () => {
    it("spawns claude, sends prompt via pipe, captures stream-json", async () => {
      const name = `quorum-e2e-claude-${Date.now()}`;
      const promptFile = join(tmpdir(), `quorum-e2e-claude-${Date.now()}.txt`);
      writeFileSync(promptFile, "respond with exactly: {\"test\":true}", "utf8");

      // Spawn shell session
      spawnSync("psmux", ["new", "-s", name, "-d"]);
      await sleep(1500);

      // Send claude pipe command
      const escapedPath = promptFile.replace(/\//g, "\\");
      const cmd = `cmd /c "type ${escapedPath} | claude -p --output-format stream-json --dangerously-skip-permissions"`;
      spawnSync("psmux", ["send-keys", "-t", name, cmd, "Enter"]);

      // Poll for completion (max 60s)
      let output = "";
      const start = Date.now();
      while (Date.now() - start < 60000) {
        await sleep(3000);
        const cap = spawnSync("psmux", ["capture-pane", "-t", name, "-p", "-S", "-100"], { encoding: "utf8" });
        output = cap.stdout ?? "";
        const flat = output.replace(/\r?\n/g, "");
        if (flat.includes('"type":"result","subtype":"success"')) break;
      }

      // Verify result event exists
      const flat = output.replace(/\r?\n/g, "");
      assert.ok(flat.includes('"type":"result"'), "Should contain result event in stream-json output");

      spawnSync("psmux", ["kill-session", "-t", name]);
      try { rmSync(promptFile); } catch (err) { console.warn("prompt file cleanup failed:", err?.message ?? err); }
    });
  });
});
