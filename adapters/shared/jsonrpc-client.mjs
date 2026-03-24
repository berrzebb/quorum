/**
 * JSON-RPC 2.0 stdio client — for Codex app-server mode.
 *
 * Ported from SoulFlow-Orchestrator src/agent/backends/codex-jsonrpc.ts.
 * Manages a child process lifecycle, NDJSON message parsing,
 * request/response matching, and server-initiated requests.
 *
 * Events emitted:
 *   "stderr"          — stderr output from child process
 *   "exit"            — child process exited (code: number)
 *   "error"           — child process spawn error
 *   "notification"    — server notification (no id, has method)
 *   "server_request"  — server-initiated request (has id + method)
 *   "unknown_message" — unrecognized message format
 *   "parse_error"     — failed to parse NDJSON line
 *
 * @module adapters/shared/jsonrpc-client
 */

import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";

/** Generate short ID. */
function shortId(len = 12) { return randomUUID().slice(0, len); }

export class JsonRpcClient extends EventEmitter {
  /** @type {import("node:child_process").ChildProcess|null} */
  #process = null;
  /** @type {Map<string, { resolve: Function, reject: Function, timer: ReturnType<typeof setTimeout> }>} */
  #pending = new Map();
  /** @type {string} */
  #buffer = "";
  /** @type {{ command: string, args?: string[], cwd?: string, env?: Record<string, string>, requestTimeoutMs?: number }} */
  #config;

  /**
   * @param {object} config
   * @param {string} config.command — executable to spawn
   * @param {string[]} [config.args] — arguments
   * @param {string} [config.cwd] — working directory
   * @param {Record<string, string>} [config.env] — extra env vars
   * @param {number} [config.requestTimeoutMs=30000] — per-request timeout
   */
  constructor(config) {
    super();
    this.#config = config;
  }

  /** Start the child process. Idempotent. */
  start() {
    if (this.#process) return;

    const env = { ...process.env, ...this.#config.env };
    this.#process = spawn(this.#config.command, this.#config.args || [], {
      cwd: this.#config.cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });

    this.#process.stdout?.on("data", (chunk) => this.#onData(chunk.toString("utf-8")));
    this.#process.stderr?.on("data", (chunk) => this.emit("stderr", chunk.toString("utf-8")));

    this.#process.on("exit", (code) => {
      this.#rejectAll(new Error(`process_exit:${code}`));
      this.#process = null;
      this.emit("exit", code);
    });

    this.#process.on("error", (err) => {
      this.#rejectAll(err);
      this.emit("error", err);
    });
  }

  /**
   * Send a JSON-RPC request and wait for response.
   * @param {string} method
   * @param {Record<string, unknown>} [params]
   * @returns {Promise<unknown>}
   */
  async request(method, params) {
    if (!this.#process?.stdin?.writable) {
      throw new Error("process_not_running");
    }

    const id = shortId();
    const msg = { jsonrpc: "2.0", id, method, ...(params ? { params } : {}) };
    const timeout = this.#config.requestTimeoutMs || 30_000;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`request_timeout:${method}`));
      }, timeout);

      this.#pending.set(id, { resolve, reject, timer });
      this.#process.stdin.write(JSON.stringify(msg) + "\n");
    });
  }

  /**
   * Send a notification (no id, no response expected).
   * @param {string} method
   * @param {Record<string, unknown>} [params]
   */
  notify(method, params) {
    if (!this.#process?.stdin?.writable) return;
    const msg = { jsonrpc: "2.0", method, ...(params ? { params } : {}) };
    this.#process.stdin.write(JSON.stringify(msg) + "\n");
  }

  /**
   * Respond to a server-initiated request.
   * @param {string|number} id
   * @param {unknown} result
   */
  respond(id, result) {
    if (!this.#process?.stdin?.writable) return;
    this.#process.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
  }

  /** Stop the child process. */
  stop() {
    this.#rejectAll(new Error("client_stopped"));
    if (this.#process) {
      this.#process.kill("SIGTERM");
      this.#process = null;
    }
  }

  /** Check if process is running. */
  isRunning() {
    return this.#process !== null && !this.#process.killed;
  }

  /** NDJSON line-by-line parsing with 10MB buffer guard. */
  #onData(chunk) {
    this.#buffer += chunk;
    if (this.#buffer.length > 10_000_000) {
      this.emit("parse_error", `buffer_overflow:${this.#buffer.length}`);
      this.#buffer = "";
      return;
    }

    const lines = this.#buffer.split("\n");
    this.#buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        this.#dispatch(JSON.parse(trimmed));
      } catch {
        this.emit("parse_error", trimmed);
      }
    }
  }

  /** Classify and dispatch: response, server request, or notification. */
  #dispatch(msg) {
    const hasId = msg.id !== null && msg.id !== undefined;
    const hasMethod = typeof msg.method === "string";
    const id = hasId ? String(msg.id) : "";

    // Response to our request
    if (hasId && this.#pending.has(id)) {
      const pending = this.#pending.get(id);
      this.#pending.delete(id);
      clearTimeout(pending.timer);

      if (msg.error) {
        pending.reject(new Error(`rpc_error:${msg.error.code}:${msg.error.message}`));
      } else {
        pending.resolve(msg.result);
      }
      return;
    }

    // Server-initiated request (has id + method)
    if (hasId && hasMethod) {
      this.emit("server_request", { id: msg.id, method: msg.method, params: msg.params || {} });
      return;
    }

    // Notification (method only, no id)
    if (hasMethod) {
      this.emit("notification", { method: msg.method, params: msg.params || {} });
      return;
    }

    this.emit("unknown_message", msg);
  }

  /** Reject all pending requests. */
  #rejectAll(error) {
    for (const [, pending] of this.#pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.#pending.clear();
  }
}
