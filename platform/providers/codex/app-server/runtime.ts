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
 * Control-plane integration (SDK-12):
 * - SessionLedger: records all sessions for traceability
 * - ProviderApprovalGate: routes approval_requested through quorum gate
 * - CompactSummary: injects wave handoff context into thread prompts
 * - OutputCursor: tracks output files for delta-only reads
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
import type { SessionLedger } from "../../session-ledger.js";
import type { ProviderApprovalGate } from "../../../bus/provider-approval-gate.js";
import { createProviderSessionRecord } from "../../../core/harness/provider-session-record.js";
import type { CompactSummary } from "../../../orchestrate/execution/wave-compact.js";
import { formatCompactContext } from "../../../orchestrate/execution/wave-compact.js";
import type { OutputCursor } from "../../../orchestrate/execution/output-tail.js";
import { createCursor, hasNewContent, tailRead } from "../../../orchestrate/execution/output-tail.js";
import { CodexAppServerClient } from "./client.js";
import { CodexAppServerMapper } from "./mapper.js";
import type { JsonRpcNotification } from "./protocol.js";

/**
 * Options for control-plane integration.
 * All optional — omitting reverts to pre-SDK-12 behavior.
 */
export interface CodexRuntimeOptions {
  binaryPath?: string;
  args?: string[];
  timeout?: number;
  /** Session ledger for traceability. */
  ledger?: SessionLedger;
  /** Approval gate for routing provider approval requests. */
  approvalGate?: ProviderApprovalGate;
}

/**
 * Internal session state tracked by the runtime.
 */
interface SessionState {
  ref: ProviderSessionRef;
  status: "running" | "completed" | "failed" | "detached";
  events: ProviderRuntimeEvent[];
  /** Output cursor for delta-only reads (if output file specified). */
  outputCursor?: OutputCursor;
  /** Compact summary injected into this session. */
  compactSummary?: CompactSummary;
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
  protected ledger?: SessionLedger;
  protected approvalGate?: ProviderApprovalGate;

  constructor(optsOrBinaryPath?: CodexRuntimeOptions | string, args?: string[], timeout?: number) {
    // Backward-compatible: accept old (binaryPath, args, timeout) or new options object
    const opts: CodexRuntimeOptions = typeof optsOrBinaryPath === "string"
      ? { binaryPath: optsOrBinaryPath, args, timeout }
      : optsOrBinaryPath ?? {};

    this.client = new CodexAppServerClient(
      opts.binaryPath ?? "codex",
      opts.args ?? ["--app-server"],
      opts.timeout ?? 30_000,
    );
    this.ledger = opts.ledger;
    this.approvalGate = opts.approvalGate;

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
   *
   * Control-plane integration:
   * - Extracts CompactSummary from metadata and injects into prompt
   * - Creates OutputCursor if metadata.outputFile is specified
   * - Records session in ledger (if available)
   */
  async start(request: SessionRuntimeRequest): Promise<ProviderSessionRef> {
    // Ensure client is connected
    if (!this.client.connected) {
      await this.client.connect();
    }

    // Extract compact summary from metadata (wave handoff)
    const compact = request.metadata?.compactSummary as CompactSummary | undefined;

    // Build prompt — inject compact context if available
    let prompt = request.prompt;
    if (compact) {
      prompt = formatCompactContext(compact) + "\n\n" + prompt;
    }

    // Create a thread with enriched prompt
    const threadRef = await this.client.createThread({
      prompt,
      cwd: request.cwd,
      metadata: request.metadata,
    });

    const ref: ProviderSessionRef = {
      provider: "codex",
      executionMode: "app_server",
      providerSessionId: `codex-as-${request.sessionId}-${Date.now()}`,
      threadId: threadRef.threadId,
    };

    // Create output cursor if output file is specified in metadata
    let outputCursor: OutputCursor | undefined;
    const outputFile = request.metadata?.outputFile as string | undefined;
    if (outputFile) {
      outputCursor = createCursor(outputFile);
    }

    this.sessions.set(ref.providerSessionId, {
      ref,
      status: "running",
      events: [],
      outputCursor,
      compactSummary: compact,
    });

    // Record in session ledger (if available)
    if (this.ledger) {
      this.ledger.upsert(createProviderSessionRecord({
        quorumSessionId: request.sessionId,
        providerRef: ref,
        contractId: request.contractId,
      }));
    }

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
   * If an output cursor is active, includes delta reads from the output file.
   */
  async poll(ref: ProviderSessionRef): Promise<ProviderRuntimeEvent[]> {
    const session = this.sessions.get(ref.providerSessionId);
    if (!session) return [];

    // Check output cursor for new content
    if (session.outputCursor && hasNewContent(session.outputCursor)) {
      const read = tailRead(session.outputCursor);
      if (read.content) {
        session.events.push({
          providerRef: ref,
          kind: "item_delta",
          payload: { delta: read.content, source: "output_cursor", truncated: read.truncated },
          ts: Date.now(),
        });
      }
      session.outputCursor = read.cursor;
    }

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
   *
   * Control-plane integration:
   * - approval_requested: routes through ProviderApprovalGate and auto-responds
   * - Terminal events: updates session ledger state
   *
   * @internal exposed as protected for testing subclasses.
   */
  protected handleNotification(notification: JsonRpcNotification): void {
    const ref = this.findRefByThread(notification.params?.threadId as string);
    const event = this.mapper.normalize(
      { method: notification.method, params: notification.params },
      ref,
    );

    if (!event) return;

    // Route to the correct session
    const sessionId = this.findSessionByThread(notification.params?.threadId as string);
    if (sessionId) {
      const session = this.sessions.get(sessionId);
      if (session) {
        session.events.push(event);

        // Route approval_requested through gate and auto-respond
        if (event.kind === "approval_requested" && this.approvalGate) {
          const decision = this.approvalGate.process({
            providerRef: ref,
            requestId: event.payload.requestId as string,
            kind: event.payload.kind as "tool" | "command" | "diff" | "network",
            reason: event.payload.reason as string,
            scope: event.payload.scope as string[] | undefined,
          });

          // Auto-respond to the client (best-effort)
          if (this.client.connected && ref.threadId) {
            this.client.respondApproval({
              requestId: event.payload.requestId as string,
              decision: decision.decision,
            }).catch(err =>
              console.warn(`[codex-runtime] approval response failed: ${(err as Error).message}`),
            );
          }
        }

        // Update status on terminal events
        if (event.kind === "session_completed") {
          session.status = "completed";
          this.updateLedgerState(session, "completed");
        }
        if (event.kind === "session_failed") {
          session.status = "failed";
          this.updateLedgerState(session, "failed");
        }
      }
    }
  }

  /** Update session ledger state (if ledger is available). */
  private updateLedgerState(session: SessionState, state: "completed" | "failed" | "detached"): void {
    if (!this.ledger) return;
    const record = this.ledger.findByProviderSession(session.ref.providerSessionId);
    if (record) {
      this.ledger.updateState(record.quorumSessionId, state);
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
