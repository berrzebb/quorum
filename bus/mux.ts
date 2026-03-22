/**
 * Process Multiplexer — cross-platform agent process management.
 *
 * Abstracts tmux (Unix) / psmux (Windows) into a unified interface.
 * Spawns agent processes in isolated sessions, captures output, monitors lifecycle.
 *
 * Falls back to raw child_process.spawn when neither mux is available.
 */

import { spawn, spawnSync, execSync, type ChildProcess } from "node:child_process";
import { platform } from "node:os";
import { createInterface } from "node:readline";
import { EventEmitter } from "node:events";

export type MuxBackend = "tmux" | "psmux" | "raw";

export interface MuxSession {
  id: string;
  name: string;
  pid?: number;
  backend: MuxBackend;
  startedAt: number;
  status: "running" | "stopped" | "error";
}

export interface SpawnOptions {
  /** Session name (used as tmux/psmux session identifier). */
  name: string;
  /** Command to execute. */
  command: string;
  /** Arguments. */
  args?: string[];
  /** Working directory. */
  cwd?: string;
  /** Environment variables. */
  env?: Record<string, string>;
}

export interface CaptureResult {
  output: string;
  lines: number;
}

export class ProcessMux extends EventEmitter {
  private backend: MuxBackend;
  private sessions = new Map<string, MuxSession>();
  private processes = new Map<string, ChildProcess>();

  constructor(preferredBackend?: MuxBackend) {
    super();
    this.backend = preferredBackend ?? detectBackend();
  }

  /** Which backend is active. */
  getBackend(): MuxBackend {
    return this.backend;
  }

  /** Spawn an agent process in an isolated session. */
  async spawn(opts: SpawnOptions): Promise<MuxSession> {
    const session: MuxSession = {
      id: `${opts.name}-${Date.now()}`,
      name: opts.name,
      backend: this.backend,
      startedAt: Date.now(),
      status: "running",
    };

    switch (this.backend) {
      case "tmux":
        this.spawnTmux(session, opts);
        break;
      case "psmux":
        this.spawnPsmux(session, opts);
        break;
      case "raw":
        this.spawnRaw(session, opts);
        break;
    }

    this.sessions.set(session.id, session);
    this.emit("spawn", session);
    return session;
  }

  /** Capture recent output from a session. */
  capture(sessionId: string, tailLines = 100): CaptureResult | null {
    const session = this.sessions.get(sessionId);
    if (!session || session.status !== "running") return null;

    switch (this.backend) {
      case "tmux":
        return this.captureTmux(session, tailLines);
      case "psmux":
        return this.capturePsmux(session, tailLines);
      case "raw":
        return this.captureRaw(sessionId);
    }
  }

  /** Send input to a running session (bidirectional pipe). */
  send(sessionId: string, input: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session || session.status !== "running") return false;

    switch (this.backend) {
      case "tmux":
        spawnSync("tmux", ["send-keys", "-t", session.name, input, "Enter"], { windowsHide: true });
        break;
      case "psmux":
        spawnSync("psmux", ["send", session.name, input], { windowsHide: true });
        break;
      case "raw": {
        const proc = this.processes.get(sessionId);
        if (proc?.stdin?.writable) {
          proc.stdin.write(input + "\n");
        } else {
          return false;
        }
        break;
      }
    }

    this.emit("send", session, input);
    return true;
  }

  /** Kill a session. */
  async kill(sessionId: string): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    switch (this.backend) {
      case "tmux":
        spawnSync("tmux", ["kill-session", "-t", session.name], { windowsHide: true });
        break;
      case "psmux":
        spawnSync("psmux", ["kill", session.name], { windowsHide: true });
        break;
      case "raw": {
        const proc = this.processes.get(sessionId);
        if (proc) proc.kill();
        break;
      }
    }

    session.status = "stopped";
    this.emit("stop", session);
    return true;
  }

  /** List active sessions. */
  list(): MuxSession[] {
    return [...this.sessions.values()];
  }

  /** Get active session count. */
  active(): number {
    return [...this.sessions.values()].filter((s) => s.status === "running").length;
  }

  /** Clean up all sessions. */
  async cleanup(): Promise<void> {
    for (const session of this.sessions.values()) {
      if (session.status === "running") {
        await this.kill(session.id);
      }
    }
    this.sessions.clear();
    this.processes.clear();
  }

  // ── tmux backend ──────────────────────────────

  private spawnTmux(session: MuxSession, opts: SpawnOptions): void {
    const cmd = [opts.command, ...(opts.args ?? [])].join(" ");
    const result = spawnSync("tmux", [
      "new-session", "-d", "-s", session.name, "-x", "200", "-y", "50",
      cmd,
    ], {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env },
      windowsHide: true,
    });

    if (result.status !== 0) {
      session.status = "error";
    }
  }

  private captureTmux(session: MuxSession, tailLines: number): CaptureResult {
    const result = spawnSync("tmux", [
      "capture-pane", "-t", session.name, "-p", "-S", `-${tailLines}`,
    ], { encoding: "utf8", windowsHide: true });

    const output = result.stdout ?? "";
    return { output, lines: output.split("\n").length };
  }

  // ── psmux backend (Windows) ───────────────────

  private spawnPsmux(session: MuxSession, opts: SpawnOptions): void {
    const cmd = [opts.command, ...(opts.args ?? [])].join(" ");
    const result = spawnSync("psmux", ["new", session.name, cmd], {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env },
      windowsHide: true,
    });

    if (result.status !== 0) {
      session.status = "error";
    }
  }

  private capturePsmux(session: MuxSession, tailLines: number): CaptureResult {
    const result = spawnSync("psmux", [
      "capture", session.name, "--tail", String(tailLines),
    ], { encoding: "utf8", windowsHide: true });

    const output = result.stdout ?? "";
    return { output, lines: output.split("\n").length };
  }

  // ── raw child_process fallback ────────────────

  private spawnRaw(session: MuxSession, opts: SpawnOptions): void {
    const proc = spawn(opts.command, opts.args ?? [], {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });

    session.pid = proc.pid;

    // Buffer output for capture
    const outputBuffer: string[] = [];
    const maxBuffer = 500;

    proc.stdout?.on("data", (data: Buffer) => {
      const lines = data.toString().split("\n");
      outputBuffer.push(...lines);
      if (outputBuffer.length > maxBuffer) {
        outputBuffer.splice(0, outputBuffer.length - maxBuffer);
      }
    });

    proc.stderr?.on("data", (data: Buffer) => {
      outputBuffer.push(...data.toString().split("\n"));
      if (outputBuffer.length > maxBuffer) {
        outputBuffer.splice(0, outputBuffer.length - maxBuffer);
      }
    });

    proc.on("exit", (code) => {
      session.status = code === 0 ? "stopped" : "error";
      this.emit("exit", session, code);
    });

    this.processes.set(session.id, proc);

    // Store buffer reference on the process for capture
    (proc as ChildProcess & { _outputBuffer?: string[] })._outputBuffer = outputBuffer;
  }

  private captureRaw(sessionId: string): CaptureResult {
    const proc = this.processes.get(sessionId) as (ChildProcess & { _outputBuffer?: string[] }) | undefined;
    if (!proc?._outputBuffer) return { output: "", lines: 0 };

    const output = proc._outputBuffer.join("\n");
    return { output, lines: proc._outputBuffer.length };
  }
}

// ── Backend detection ─────────────────────────

function detectBackend(): MuxBackend {
  if (platform() === "win32") {
    try {
      const result = spawnSync("psmux", ["--version"], { encoding: "utf8", timeout: 3000, windowsHide: true });
      if (result.status === 0) return "psmux";
    } catch { /* not available */ }
  } else {
    try {
      const result = spawnSync("tmux", ["-V"], { encoding: "utf8", timeout: 3000, windowsHide: true });
      if (result.status === 0) return "tmux";
    } catch { /* not available */ }
  }

  return "raw";
}

// ── Auto-install ──────────────────────────────

const INSTALL_COMMANDS: Record<string, { check: string; install: string; name: string }> = {
  win32: {
    check: "psmux",
    install: "winget install psmux",
    name: "psmux",
  },
  darwin: {
    check: "tmux",
    install: "brew install tmux",
    name: "tmux",
  },
  linux: {
    check: "tmux",
    install: "sudo apt-get install -y tmux || sudo dnf install -y tmux || sudo pacman -S --noconfirm tmux",
    name: "tmux",
  },
};

async function promptYesNo(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === "y" || answer.trim().toLowerCase() === "yes");
    });
  });
}

/**
 * Ensure a mux backend is available. If not, offer to install it.
 * Call this once at daemon startup.
 *
 * Returns the resolved backend (may upgrade from "raw" to tmux/psmux after install).
 */
export async function ensureMuxBackend(): Promise<MuxBackend> {
  const current = detectBackend();
  if (current !== "raw") return current;

  const os = platform();
  const info = INSTALL_COMMANDS[os];
  if (!info) return "raw";

  console.log(`\n\x1b[33m${info.name} not found.\x1b[0m`);
  console.log(`Multi-agent session management works best with ${info.name}.`);
  console.log(`Without it, quorum falls back to basic child processes (no capture/resume).\n`);

  const yes = await promptYesNo(`Install ${info.name}? (${info.install}) [y/N] `);
  if (!yes) {
    console.log("Continuing with raw process backend.\n");
    return "raw";
  }

  console.log(`\nInstalling ${info.name}...`);
  try {
    execSync(info.install, { stdio: "inherit", windowsHide: true });
    console.log(`\x1b[32m✓ ${info.name} installed successfully.\x1b[0m\n`);
    return detectBackend();
  } catch {
    console.error(`\x1b[31m✗ Installation failed. Continuing with raw backend.\x1b[0m\n`);
    return "raw";
  }
}
