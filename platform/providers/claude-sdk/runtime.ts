/**
 * Claude SDK Session Runtime — implements SessionRuntime for in-process SDK sessions.
 *
 * When SDK IS installed and exposes session APIs, delegates to real SDK calls.
 * When SDK is NOT installed or lacks session APIs, start() throws — no silent no-ops.
 *
 * Manages session lifecycle (start/resume/send/stop/poll/status) and
 * exposes pushEvent/complete/fail for SDK callback integration.
 *
 * Control-plane integration (SDK-13):
 * - SessionLedger: records all sessions for traceability
 * - CompactSummary: injects wave handoff context into session prompts
 */

import type {
  SessionRuntime,
  ProviderSessionRef,
  SessionRuntimeRequest,
  ProviderRuntimeEvent,
  ProviderExecutionMode,
} from "../session-runtime.js";
import type { SessionLedger } from "../session-ledger.js";
import { createProviderSessionRecord } from "../../core/harness/provider-session-record.js";
import type { CompactSummary } from "../../orchestrate/execution/wave-compact.js";
import { formatCompactContext } from "../../orchestrate/execution/wave-compact.js";
import { ClaudeSdkSessionApi } from "./session-api.js";
import { loadClaudeSdk } from "./tool-bridge.js";

/**
 * Options for control-plane integration.
 * All optional — omitting reverts to pre-SDK-13 behavior.
 */
export interface ClaudeRuntimeOptions {
  /** Session ledger for traceability. */
  ledger?: SessionLedger;
}

interface SessionState {
  ref: ProviderSessionRef;
  status: "running" | "completed" | "failed" | "detached";
  events: ProviderRuntimeEvent[];
  /** SDK-native session handle (when SDK is available and functional). */
  sdkSession: unknown;
  /** Inputs sent during session (for traceability/diagnostics). */
  inputs: string[];
  /** Compact summary injected into this session. */
  compactSummary?: CompactSummary;
}

/** Minimum SDK shape required for session management. */
interface SdkSessionMethods {
  createSession: (opts: Record<string, unknown>) => Promise<unknown>;
  sendMessage: (session: unknown, input: string) => Promise<void>;
  stopSession?: (session: unknown) => Promise<void>;
}

export class ClaudeSdkRuntime implements SessionRuntime {
  readonly provider = "claude" as const;
  readonly mode: ProviderExecutionMode = "agent_sdk";

  private sessionApi = new ClaudeSdkSessionApi();
  private sessions = new Map<string, SessionState>();
  protected sdkMethods: SdkSessionMethods | null = null;
  protected sdkChecked = false;
  protected ledger?: SessionLedger;

  constructor(opts?: ClaudeRuntimeOptions) {
    this.ledger = opts?.ledger;
  }

  async isAvailable(): Promise<boolean> {
    return this.sessionApi.isAvailable();
  }

  /**
   * Resolve SDK session methods. Returns null if SDK is not installed
   * or does not expose the required createSession/sendMessage APIs.
   * Protected so test subclasses can inject mock SDK methods.
   */
  protected async resolveSdkMethods(): Promise<SdkSessionMethods | null> {
    if (this.sdkChecked) return this.sdkMethods;
    this.sdkChecked = true;

    const result = await loadClaudeSdk();
    if (!result.available || !result.sdk) return null;

    const sdk = result.sdk as Record<string, unknown>;
    if (typeof sdk.createSession !== "function" || typeof sdk.sendMessage !== "function") {
      return null;
    }

    this.sdkMethods = {
      createSession: sdk.createSession as SdkSessionMethods["createSession"],
      sendMessage: sdk.sendMessage as SdkSessionMethods["sendMessage"],
      stopSession: typeof sdk.stopSession === "function"
        ? sdk.stopSession as SdkSessionMethods["stopSession"]
        : undefined,
    };
    return this.sdkMethods;
  }

  /**
   * Start a new Claude SDK session.
   *
   * Control-plane integration:
   * - Extracts CompactSummary from metadata and injects into prompt
   * - Records session in ledger (if available)
   */
  async start(request: SessionRuntimeRequest): Promise<ProviderSessionRef> {
    const available = await this.isAvailable();
    if (!available) {
      throw new Error(
        "Claude Agent SDK is not available. Install @anthropic-ai/claude-agent-sdk or use cli_exec mode."
      );
    }

    const methods = await this.resolveSdkMethods();
    if (!methods) {
      throw new Error(
        "Claude Agent SDK is installed but does not expose createSession/sendMessage. " +
        "Upgrade the SDK or use cli_exec mode."
      );
    }

    // Extract compact summary from metadata (wave handoff)
    const compact = request.metadata?.compactSummary as CompactSummary | undefined;

    // Build prompt — inject compact context if available
    let prompt = request.prompt;
    if (compact) {
      prompt = formatCompactContext(compact) + "\n\n" + prompt;
    }

    const sdkSession = await methods.createSession({
      prompt,
      cwd: request.cwd,
      metadata: request.metadata,
    });

    const ref: ProviderSessionRef = {
      provider: "claude",
      executionMode: "agent_sdk",
      providerSessionId: `claude-sdk-${request.sessionId}-${Date.now()}`,
    };

    this.sessions.set(ref.providerSessionId, {
      ref,
      status: "running",
      events: [],
      sdkSession,
      inputs: [prompt],
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

  async resume(ref: ProviderSessionRef, request?: Partial<SessionRuntimeRequest>): Promise<void> {
    const session = this.sessions.get(ref.providerSessionId);
    if (!session) {
      throw new Error(`Session not found: ${ref.providerSessionId}`);
    }
    if (session.status === "completed" || session.status === "failed") {
      throw new Error(`Cannot resume ${session.status} session: ${ref.providerSessionId}`);
    }
    session.status = "running";

    // Forward prompt to SDK session if provided
    if (request?.prompt && session.sdkSession && this.sdkMethods) {
      session.inputs.push(request.prompt);
      await this.sdkMethods.sendMessage(session.sdkSession, request.prompt);
    }
  }

  async send(ref: ProviderSessionRef, input: string): Promise<void> {
    const session = this.sessions.get(ref.providerSessionId);
    if (!session) {
      throw new Error(`Session not found: ${ref.providerSessionId}`);
    }
    if (session.status !== "running") {
      throw new Error(`Cannot send to ${session.status} session: ${ref.providerSessionId}`);
    }
    if (!this.sdkMethods) {
      throw new Error("SDK session methods not available — cannot send");
    }

    session.inputs.push(input);
    await this.sdkMethods.sendMessage(session.sdkSession, input);
  }

  async stop(ref: ProviderSessionRef): Promise<void> {
    const session = this.sessions.get(ref.providerSessionId);
    if (!session) return;

    if (session.sdkSession && this.sdkMethods?.stopSession) {
      try { await this.sdkMethods.stopSession(session.sdkSession); } catch (err) { console.warn(`[claude-sdk] stopSession failed: ${(err as Error).message}`); }
    }

    session.status = "detached";
  }

  async poll(ref: ProviderSessionRef): Promise<ProviderRuntimeEvent[]> {
    const session = this.sessions.get(ref.providerSessionId);
    if (!session) return [];

    const events = [...session.events];
    session.events = [];
    return events;
  }

  async status(ref: ProviderSessionRef): Promise<"running" | "completed" | "failed" | "detached"> {
    const session = this.sessions.get(ref.providerSessionId);
    if (!session) return "detached";
    return session.status;
  }

  pushEvent(providerSessionId: string, event: ProviderRuntimeEvent): void {
    const session = this.sessions.get(providerSessionId);
    if (session) {
      session.events.push(event);
    }
  }

  complete(providerSessionId: string): void {
    const session = this.sessions.get(providerSessionId);
    if (session) {
      session.status = "completed";
      this.updateLedgerState(session, "completed");
    }
  }

  fail(providerSessionId: string): void {
    const session = this.sessions.get(providerSessionId);
    if (session) {
      session.status = "failed";
      this.updateLedgerState(session, "failed");
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
}
