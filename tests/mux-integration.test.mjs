/**
 * ProcessMux integration tests — real psmux/tmux operations.
 * Skips if no mux backend available (CI environments).
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { ProcessMux } from "../dist/platform/bus/mux.js";

// Skip all tests if no mux backend available
const backend = detectBackend();
const SKIP = backend === "raw";

function detectBackend() {
  if (process.platform === "win32") {
    try {
      const r = spawnSync("psmux", ["version"], { encoding: "utf8", timeout: 3000 });
      if (r.status === 0) return "psmux";
    } catch {}
  } else {
    try {
      const r = spawnSync("tmux", ["-V"], { encoding: "utf8", timeout: 3000 });
      if (r.status === 0) return "tmux";
    } catch {}
  }
  return "raw";
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

describe("ProcessMux integration", { skip: SKIP ? "no mux backend available" : false }, () => {
  let mux;

  before(() => { mux = new ProcessMux(); });
  after(async () => { if (mux) await mux.cleanup(); });

  it("detects correct backend", () => {
    assert.equal(mux.getBackend(), backend);
  });

  it("spawns a default shell session, captures, kills", async () => {
    // Use default shell (stays alive) not cmd /c (exits immediately)
    const session = await mux.spawn({
      name: `quorum-test-${Date.now()}`,
      command: "",
      args: [],
    });

    assert.equal(session.status, "running");
    assert.ok(session.id);
    assert.ok(session.name);

    // Shell needs time to initialize
    await sleep(2500);

    const cap = mux.capture(session.id, 20);
    assert.ok(cap, "capture should return result");
    // Default shell shows a prompt — any output means capture works
    assert.ok(cap.output !== undefined);

    await mux.kill(session.id);
    assert.equal(session.status, "stopped");
  });

  it("sends keys to a session and captures result", async () => {
    const session = await mux.spawn({
      name: `quorum-test-send-${Date.now()}`,
      command: "",
      args: [],
    });

    assert.equal(session.status, "running");

    // Shell needs more time to initialize on Windows (pwsh startup)
    await sleep(3000);

    // Send a command with unique marker
    const marker = `mux-marker-${Date.now()}`;
    mux.send(session.id, `echo ${marker}`);

    await sleep(2000);

    const cap = mux.capture(session.id, 30);
    assert.ok(cap);
    assert.ok(cap.output.includes(marker), `Expected output to contain '${marker}', got: ${cap.output.slice(0, 300)}`);

    await mux.kill(session.id);
  });

  it("registerExternal makes session capturable", async () => {
    // Create a session directly via CLI
    const name = `quorum-test-ext-${Date.now()}`;
    if (backend === "psmux") {
      spawnSync("psmux", ["new", "-s", name, "-d"], { windowsHide: true });
    } else {
      spawnSync("tmux", ["new-session", "-d", "-s", name], { windowsHide: true });
    }

    await sleep(1000);

    // Register it in our mux instance
    mux.registerExternal({
      id: `${name}-ext`,
      name,
      backend,
      startedAt: Date.now(),
      status: "running",
    });

    // Should be in list
    const sessions = mux.list();
    assert.ok(sessions.find(s => s.id === `${name}-ext`));

    // Should be capturable
    const cap = mux.capture(`${name}-ext`, 10);
    assert.ok(cap);

    // Cleanup
    mux.unregister(`${name}-ext`);
    if (backend === "psmux") {
      spawnSync("psmux", ["kill-session", "-t", name], { windowsHide: true });
    } else {
      spawnSync("tmux", ["kill-session", "-t", name], { windowsHide: true });
    }
  });

  it("active() counts running sessions", async () => {
    const before = mux.active();
    const session = await mux.spawn({
      name: `quorum-test-active-${Date.now()}`,
      command: "",
      args: [],
    });

    assert.equal(mux.active(), before + 1);
    await mux.kill(session.id);
  });
});
