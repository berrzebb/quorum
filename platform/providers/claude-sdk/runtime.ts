/**
 * Claude SDK Session Runtime — implements SessionRuntime for in-process SDK sessions.
 *
 * Falls back gracefully when the Claude Agent SDK is not installed.
 * Manages session lifecycle (start/resume/send/stop/poll/status) and
 * exposes pushEvent/complete/fail for SDK callback integration.
 *
 * @module providers/claude-sdk/runtime
 */

import type {
  SessionRuntime,
  ProviderSessionRef,
  SessionRuntimeRequest,
  ProviderRuntimeEvent,
  ProviderExecutionMode,
} from "../session-runtime.js";
import { ClaudeSdkSessionApi } from "./session-api.js";

/**
 * Internal session state tracked by the runtime.
 */
interface SessionState {
  ref: ProviderSessionRef;
  status: "running" | "completed" | "failed" | "detached";
  events: ProviderRuntimeEvent[];
}

/**
 * Claude Agent SDK session runtime.
 * Implements SessionRuntime for in-process SDK-based sessions.
 *
 * Falls back gracefully when SDK is not installed.
 */
export class ClaudeSdkRuntime implements SessionRuntime {
  readonly provider = "claude" as const;
  readonly mode: ProviderExecutionMode = "agent_sdk";

  private sessionApi = new ClaudeSdkSessionApi();
  private sessions = new Map<string, SessionState>();

  /**
   * Check if Claude SDK runtime is available.
   */
  async isAvailable(): Promise<boolean> {
    return this.sessionApi.isAvailable();
  }

  /**
   * Start a new SDK session.
   */
  async start(request: SessionRuntimeRequest): Promise<ProviderSessionRef> {
    const available = await this.isAvailable();
    if (!available) {
      throw new Error(
        "Claude Agent SDK is not available. Install @anthropic-ai/claude-agent-sdk or use cli_exec mode."
      );
    }

    const ref: ProviderSessionRef = {
      provider: "claude",
      executionMode: "agent_sdk",
      providerSessionId: `claude-sdk-${request.sessionId}-${Date.now()}`,
    };

    this.sessions.set(ref.providerSessionId, {
      ref,
      status: "running",
      events: [],
    });

    return ref;
  }

  /**
   * Resume an existing SDK session.
   */
  async resume(ref: ProviderSessionRef, _request?: Partial<SessionRuntimeRequest>): Promise<void> {
    const session = this.sessions.get(ref.providerSessionId);
    if (!session) {
      throw new Error(`Session not found: ${ref.providerSessionId}`);
    }
    if (session.status === "completed" || session.status === "failed") {
      throw new Error(`Cannot resume ${session.status} session: ${ref.providerSessionId}`);
    }
    session.status = "running";
  }

  /**
   * Send input to an active SDK session.
   */
  async send(ref: ProviderSessionRef, _input: string): Promise<void> {
    const session = this.sessions.get(ref.providerSessionId);
    if (!session) {
      throw new Error(`Session not found: ${ref.providerSessionId}`);
    }
    if (session.status !== "running") {
      throw new Error(`Cannot send to ${session.status} session: ${ref.providerSessionId}`);
    }
    // Actual SDK send would go here
  }

  /**
   * Stop an active SDK session.
   */
  async stop(ref: ProviderSessionRef): Promise<void> {
    const session = this.sessions.get(ref.providerSessionId);
    if (!session) return; // idempotent
    session.status = "detached";
  }

  /**
   * Poll for new events from the SDK session.
   */
  async poll(ref: ProviderSessionRef): Promise<ProviderRuntimeEvent[]> {
    const session = this.sessions.get(ref.providerSessionId);
    if (!session) return [];

    // Drain accumulated events
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
   * Push an event to a session's event queue (used by SDK callbacks).
   */
  pushEvent(providerSessionId: string, event: ProviderRuntimeEvent): void {
    const session = this.sessions.get(providerSessionId);
    if (session) {
      session.events.push(event);
    }
  }

  /**
   * Mark a session as completed.
   */
  complete(providerSessionId: string): void {
    const session = this.sessions.get(providerSessionId);
    if (session) {
      session.status = "completed";
    }
  }

  /**
   * Mark a session as failed.
   */
  fail(providerSessionId: string): void {
    const session = this.sessions.get(providerSessionId);
    if (session) {
      session.status = "failed";
    }
  }
}
