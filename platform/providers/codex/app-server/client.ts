/**
 * Codex App Server JSON-RPC client over stdio.
 *
 * @deprecated Since v0.5.0. Prefer codex-plugin-cc's broker-based client
 * (openai/codex-plugin-cc) which provides persistent sessions, multiplexing,
 * and structured output validation. Use {@link CodexPluginAuditor} instead.
 * This module will be removed in v0.6.0.
 *
 * Thin typed wrapper around a subprocess running `codex --app-server`.
 * Mirrors the pattern from platform/adapters/shared/jsonrpc-client.mjs
 * but uses TypeScript types from ./protocol.ts.
 *
 * Buffer guard: 10MB max (same as jsonrpc-client.mjs).
 * Timeout: per-request configurable (default 30s).
 *
 * Events emitted:
 *   "notification"  — server notification (JsonRpcNotification)
 *   "stderr"        — stderr output string
 *   "exit"          — child process exit code
 *   "error"         — child process spawn error
 *   "parse_error"   — failed to parse NDJSON line
 *   Plus every notification method name (e.g. "thread/started") with params
 */

import { EventEmitter } from "node:events";
import { spawn, type ChildProcess } from "node:child_process";
import type {
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcNotification,
  InitializeParams,
  InitializeResult,
  CreateThreadParams,
  ThreadRef,
  SendInputParams,
  ApprovalResponseParams,
  StopThreadParams,
  ThreadStatusParams,
  ThreadStatus,
} from "./protocol.js";
import { CODEX_METHODS } from "./protocol.js";

/** Maximum buffer size before forced reset (10MB). */
const MAX_BUFFER = 10_000_000;

/**
 * Client for Codex App Server over stdio JSON-RPC.
 * Manages subprocess lifecycle and message routing.
 */
export class CodexAppServerClient extends EventEmitter {
  private process: ChildProcess | null = null;
  private nextId = 1;
  private pending = new Map<number | string, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();
  private buffer = "";
  private _connected = false;

  constructor(
    private readonly binaryPath: string = "codex",
    private readonly args: string[] = ["--app-server"],
    private readonly timeout: number = 30_000,
  ) {
    super();
  }

  get connected(): boolean {
    return this._connected;
  }

  /**
   * Start the App Server subprocess and initialize the connection.
   */
  async connect(params?: Partial<InitializeParams>): Promise<InitializeResult> {
    if (this._connected) throw new Error("Already connected");

    this.process = spawn(this.binaryPath, this.args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
      windowsHide: true,
    });

    this.process.stdout?.on("data", (chunk: Buffer) => this.onData(chunk));
    this.process.stderr?.on("data", (chunk: Buffer) => {
      this.emit("stderr", chunk.toString());
    });
    this.process.on("exit", (code) => {
      this._connected = false;
      this.rejectAll(new Error(`App Server exited with code ${code}`));
      this.process = null;
      this.emit("exit", code);
    });
    this.process.on("error", (err) => {
      this._connected = false;
      this.rejectAll(err);
      this.emit("error", err);
    });

    const result = await this.request<InitializeResult>(CODEX_METHODS.INITIALIZE, {
      clientName: "quorum",
      clientVersion: "0.5.0",
      ...params,
    });

    this._connected = true;
    return result;
  }

  /**
   * Create a new thread (starts a coding session).
   */
  async createThread(params: CreateThreadParams): Promise<ThreadRef> {
    return this.request<ThreadRef>(CODEX_METHODS.CREATE_THREAD, params);
  }

  /**
   * Send input to an existing thread.
   */
  async sendInput(params: SendInputParams): Promise<void> {
    await this.request(CODEX_METHODS.SEND_INPUT, params);
  }

  /**
   * Respond to an approval request.
   */
  async respondApproval(params: ApprovalResponseParams): Promise<void> {
    await this.request(CODEX_METHODS.APPROVAL_RESPONSE, params);
  }

  /**
   * Stop a thread.
   */
  async stopThread(params: StopThreadParams): Promise<void> {
    await this.request(CODEX_METHODS.STOP_THREAD, params);
  }

  /**
   * Get thread status.
   */
  async threadStatus(params: ThreadStatusParams): Promise<ThreadStatus> {
    return this.request<ThreadStatus>(CODEX_METHODS.THREAD_STATUS, params);
  }

  /**
   * Disconnect and kill the subprocess.
   */
  async disconnect(): Promise<void> {
    this._connected = false;
    this.rejectAll(new Error("Client disconnected"));
    if (this.process && !this.process.killed) {
      this.process.kill("SIGTERM");
      this.process = null;
    }
  }

  // ─── Internal ──────────────────────────────────

  private async request<T = unknown>(method: string, params?: Record<string, unknown> | object): Promise<T> {
    if (!this.process?.stdin?.writable) {
      throw new Error("Not connected to App Server");
    }

    const id = this.nextId++;
    const request: JsonRpcRequest = {
      jsonrpc: "2.0",
      id,
      method,
      params: params as Record<string, unknown>,
    };

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Request ${method} timed out after ${this.timeout}ms`));
      }, this.timeout);

      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value as T);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
        timer,
      });

      this.process!.stdin!.write(JSON.stringify(request) + "\n");
    });
  }

  private onData(chunk: Buffer): void {
    this.buffer += chunk.toString();

    // Buffer overflow guard (matches jsonrpc-client.mjs)
    if (this.buffer.length > MAX_BUFFER) {
      this.emit("parse_error", `buffer_overflow:${this.buffer.length}`);
      this.buffer = "";
      return;
    }

    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const msg = JSON.parse(trimmed);
        this.dispatch(msg);
      } catch (err) {
        console.warn(`[codex-client] JSON-RPC parse error: ${(err as Error).message}`);
        this.emit("parse_error", trimmed);
      }
    }
  }

  /**
   * Classify and dispatch: response, server-initiated request, or notification.
   * Mirrors jsonrpc-client.mjs #dispatch() classification logic.
   */
  private dispatch(msg: Record<string, unknown>): void {
    const hasId = msg.id !== null && msg.id !== undefined;
    const hasMethod = typeof msg.method === "string";

    // Response to our request
    if (hasId && this.pending.has(msg.id as number | string)) {
      this.handleResponse(msg as unknown as JsonRpcResponse);
      return;
    }

    // Server-initiated request (has id + method, but not in our pending map)
    if (hasId && hasMethod) {
      this.emit("server_request", {
        id: msg.id,
        method: msg.method,
        params: msg.params || {},
      });
      return;
    }

    // Notification (method only, no id)
    if (hasMethod) {
      this.handleNotification(msg as unknown as JsonRpcNotification);
      return;
    }

    this.emit("unknown_message", msg);
  }

  private handleResponse(response: JsonRpcResponse): void {
    const pending = this.pending.get(response.id as number | string);
    if (!pending) return;
    this.pending.delete(response.id as number | string);

    if (response.error) {
      clearTimeout(pending.timer);
      pending.reject(new Error(`${response.error.code}: ${response.error.message}`));
    } else {
      clearTimeout(pending.timer);
      pending.resolve(response.result);
    }
  }

  private handleNotification(notification: JsonRpcNotification): void {
    this.emit("notification", notification);
    this.emit(notification.method, notification.params);
  }

  private rejectAll(error: Error): void {
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}
