/**
 * Codex App Server session runtime.
 * Implements SessionRuntime for Codex's bidirectional JSON-RPC App Server.
 *
 * @deprecated Since v0.5.0. Prefer codex-plugin-cc's session management
 * (openai/codex-plugin-cc) which provides broker-based multiplexing,
 * thread persistence, and background job execution. This module will be
 * removed in v0.6.0.
 *
 * Falls back gracefully when codex binary is not available.
 *
 * @module providers/codex/app-server/runtime
 */

import type {
  SessionRuntime,
  ProviderSessionRef,
  SessionRuntimeRequest,
  ProviderRuntimeEvent,
  ProviderExecutionMode,
} from "../../session-runtime.js";
import { CodexAppServerClient } from "./client.js";
import { CodexAppServerMapper } from "./mapper.js";
import type { JsonRpcNotification } from "./protocol.js";

/**
 * Internal session state tracked by the runtime.
 */
interface SessionState {
  ref: ProviderSessionRef;
  status: "running" | "completed" | "failed" | "detached";
  events: ProviderRuntimeEvent[];
}

/**
 * Codex App Server session runtime.
 * Implements SessionRuntime for Codex's bidirectional JSON-RPC App Server.
 *
 * Falls back gracefully when codex binary is not available.
 */
export class CodexAppServerRuntime implements SessionRuntime {
  readonly provider = "codex" as const;
  readonly mode: ProviderExecutionMode = "app_server";

  /** @internal exposed for testing subclasses */
  protected client: CodexAppServerClient;
  protected mapper = new CodexAppServerMapper();
  protected sessions = new Map<string, SessionState>();

  constructor(binaryPath?: string, args?: string[], timeout?: number) {
    this.client = new CodexAppServerClient(
      binaryPath ?? "codex",
      args ?? ["--app-server"],
      timeout ?? 30_000,
    );

    // Wire up notifications from the client
    this.client.on("notification", (notification: JsonRpcNotification) => {
      this.handleNotification(notification);
    });
  }

  /**
   * Check if Codex App Server is available by trying to resolve the binary.
   */
  async isAvailable(): Promise<boolean> {
    try {
      const { execFileSync } = await import("node:child_process");
      execFileSync(this.client["binaryPath"] ?? "codex", ["--version"], {
        timeout: 5000,
        stdio: "pipe",
      });
      return true;
    } catch (err) {
      console.warn(`[codex-runtime] availability check failed: ${(err as Error).message}`);
      return false;
    }
  }

  /**
   * Start a new Codex App Server session.
   * Connects to the subprocess and creates a thread.
   */
  async start(request: SessionRuntimeRequest): Promise<ProviderSessionRef> {
    // Ensure client is connected
    if (!this.client.connected) {
      await this.client.connect();
    }

    // Create a thread
    const threadRef = await this.client.createThread({
      prompt: request.prompt,
      cwd: request.cwd,
      metadata: request.metadata,
    });

    const ref: ProviderSessionRef = {
      provider: "codex",
      executionMode: "app_server",
      providerSessionId: `codex-as-${request.sessionId}-${Date.now()}`,
      threadId: threadRef.threadId,
    };

    this.sessions.set(ref.providerSessionId, {
      ref,
      status: "running",
      events: [],
    });

    return ref;
  }

  /**
   * Resume an existing session by re-attaching to a thread.
   */
  async resume(ref: ProviderSessionRef, request?: Partial<SessionRuntimeRequest>): Promise<void> {
    const session = this.sessions.get(ref.providerSessionId);
    if (!session) {
      throw new Error(`Session not found: ${ref.providerSessionId}`);
    }
    if (session.status === "completed" || session.status === "failed") {
      throw new Error(`Cannot resume ${session.status} session`);
    }

    if (request?.prompt && ref.threadId) {
      await this.client.sendInput({
        threadId: ref.threadId,
        input: request.prompt,
      });
    }

    session.status = "running";
  }

  /**
   * Send input to the active thread.
   */
  async send(ref: ProviderSessionRef, input: string): Promise<void> {
    const session = this.sessions.get(ref.providerSessionId);
    if (!session) {
      throw new Error(`Session not found: ${ref.providerSessionId}`);
    }
    if (session.status !== "running") {
      throw new Error(`Cannot send to ${session.status} session`);
    }
    if (!ref.threadId) {
      throw new Error("No threadId for send");
    }

    await this.client.sendInput({
      threadId: ref.threadId,
      input,
    });
  }

  /**
   * Stop a session by stopping the thread.
   */
  async stop(ref: ProviderSessionRef): Promise<void> {
    const session = this.sessions.get(ref.providerSessionId);
    if (!session) return; // idempotent

    if (ref.threadId) {
      try {
        await this.client.stopThread({ threadId: ref.threadId });
      } catch (err) {
        console.warn(`[codex-runtime] best-effort thread stop failed: ${(err as Error).message}`);
      }
    }

    session.status = "detached";
  }

  /**
   * Poll for new events from the session.
   */
  async poll(ref: ProviderSessionRef): Promise<ProviderRuntimeEvent[]> {
    const session = this.sessions.get(ref.providerSessionId);
    if (!session) return [];

    const events = [...session.events];
    session.events = [];
    return events;
  }

  /**
   * Get session status.
   */
  async status(ref: ProviderSessionRef): Promise<"running" | "completed" | "failed" | "detached"> {
    const session = this.sessions.get(ref.providerSessionId);
    if (!session) return "detached";
    return session.status;
  }

  /**
   * Disconnect the App Server client.
   */
  async disconnect(): Promise<void> {
    await this.client.disconnect();
    for (const session of this.sessions.values()) {
      session.status = "detached";
    }
  }

  // ─── Internal ──────────────────────────────────

  /**
   * Handle a notification from the JSON-RPC client.
   * @internal exposed as protected for testing subclasses.
   */
  protected handleNotification(notification: JsonRpcNotification): void {
    const event = this.mapper.normalize(
      { method: notification.method, params: notification.params },
      this.findRefByThread(notification.params?.threadId as string),
    );

    if (!event) return;

    // Route to the correct session
    const sessionId = this.findSessionByThread(notification.params?.threadId as string);
    if (sessionId) {
      const session = this.sessions.get(sessionId);
      if (session) {
        session.events.push(event);

        // Update status on terminal events
        if (event.kind === "session_completed") session.status = "completed";
        if (event.kind === "session_failed") session.status = "failed";
      }
    }
  }

  private findSessionByThread(threadId?: string): string | undefined {
    if (!threadId) return undefined;
    for (const [id, session] of this.sessions) {
      if (session.ref.threadId === threadId) return id;
    }
    return undefined;
  }

  private findRefByThread(threadId?: string): ProviderSessionRef {
    if (threadId) {
      for (const session of this.sessions.values()) {
        if (session.ref.threadId === threadId) return session.ref;
      }
    }
    // Fallback ref for unmapped notifications
    return {
      provider: "codex",
      executionMode: "app_server",
      providerSessionId: "unknown",
      threadId,
    };
  }
}
