/**
 * MuxAdapter — bridges ProcessMux sessions with CliAdapter/NdjsonParser,
 * and OpenAI-compatible API sessions via ApiAdapter.
 *
 * Two session types:
 *   CLI sessions (claude, codex, gemini):
 *     ProcessMux.spawn()  → tmux session per model
 *     ProcessMux.capture() → NdjsonParser.feed() → AgentOutputMessage[]
 *     ProcessMux.send()    → CliAdapter.formatInput() → model stdin
 *
 *   API sessions (ollama, vllm, openai-api):
 *     createApiAdapterFromSpec() → HTTP session
 *     apiAdapter.send()          → chat completions API → AgentOutputMessage[]
 *     No ProcessMux needed — direct HTTP.
 *
 * @module adapters/shared/mux-adapter
 */

import { NdjsonParser } from "./ndjson-parser.mjs";
import { createCliAdapter } from "./cli-adapter.mjs";
import { createApiAdapterFromSpec, API_PRESETS } from "./api-adapter.mjs";

/** Providers that use HTTP API instead of CLI spawn. */
const API_PROVIDERS = new Set(Object.keys(API_PRESETS));

/**
 * @typedef {{ provider: string, role?: string, model?: string, systemPrompt?: string, allowedTools?: string[], mcpConfig?: string, tools?: any[], toolExecutor?: Function }} ModelConfig
 *
 * @typedef {{ sessionId: string, provider: string, role: string, adapter: object, parser: NdjsonParser|null, messages: import("./ndjson-parser.mjs").AgentOutputMessage[], complete: boolean, _api?: boolean }} ModelSession
 */

export class MuxAdapter {
  /** @type {import("../../bus/mux.ts").ProcessMux} */
  #mux;
  /** @type {Map<string, ModelSession>} */
  #sessions = new Map();
  /** @type {string} */
  #cwd;

  /**
   * @param {import("../../bus/mux.ts").ProcessMux} mux — ProcessMux instance
   * @param {string} cwd — working directory for spawned processes
   */
  constructor(mux, cwd) {
    this.#mux = mux;
    this.#cwd = cwd;
  }

  /**
   * Spawn a model session — auto-detects CLI vs API based on provider.
   *
   * CLI providers (claude, codex, gemini): spawn via ProcessMux (tmux/psmux).
   * API providers (ollama, vllm, openai, anthropic): create HTTP session (no process).
   *
   * @param {ModelConfig} config
   * @returns {Promise<ModelSession>}
   */
  async spawn(config) {
    const providerBase = config.provider.split(":")[0];

    // API-based providers — no CLI process needed
    if (API_PROVIDERS.has(providerBase)) {
      return this.#spawnApi(config);
    }

    // CLI-based providers — existing tmux/psmux path
    const adapter = createCliAdapter(config.provider);
    const parser = new NdjsonParser(adapter);

    const args = adapter.buildArgs({
      model: config.model,
      systemPrompt: config.systemPrompt,
      allowedTools: config.allowedTools,
      mcpConfig: config.mcpConfig,
    });

    const command = config.provider;
    const sessionName = `quorum-${config.role || config.provider}-${Date.now()}`;

    const muxSession = await this.#mux.spawn({
      name: sessionName,
      command,
      args,
      cwd: this.#cwd,
    });

    const session = {
      sessionId: muxSession.id,
      provider: config.provider,
      role: config.role || config.provider,
      adapter,
      parser,
      messages: [],
      complete: false,
      _api: false,
    };

    this.#sessions.set(muxSession.id, session);
    return session;
  }

  /**
   * Spawn an API-based session (no CLI process).
   * @param {ModelConfig} config
   * @returns {Promise<ModelSession>}
   */
  #spawnApi(config) {
    const spec = config.model
      ? `${config.provider}:${config.model}`
      : config.provider;

    const apiAdapter = createApiAdapterFromSpec(spec, {
      tools: config.tools,
      toolExecutor: config.toolExecutor,
    });

    if (config.systemPrompt) {
      apiAdapter.setSystemPrompt(config.systemPrompt);
    }

    const session = {
      sessionId: apiAdapter.sessionId,
      provider: config.provider,
      role: config.role || config.provider,
      adapter: apiAdapter,
      parser: null,
      messages: [],
      complete: false,
      _api: true,
    };

    this.#sessions.set(apiAdapter.sessionId, session);
    return Promise.resolve(session);
  }

  /**
   * Send a prompt to a model session (CLI path: stdin write).
   * For API sessions, use sendAsync() instead.
   *
   * @param {string} sessionId
   * @param {string} content — prompt text
   * @returns {boolean}
   */
  send(sessionId, content) {
    const session = this.#sessions.get(sessionId);
    if (!session) return false;

    // API sessions cannot use sync send — queue for sendAsync
    if (session._api) return false;

    const formatted = session.adapter.formatInput({ type: "user_message", content });
    return this.#mux.send(sessionId, formatted.trim());
  }

  /**
   * Send a prompt and await response — unified for both CLI and API sessions.
   *
   * CLI sessions: sends via stdin, then polls until complete.
   * API sessions: makes HTTP API call with tool-calling loop, returns immediately.
   *
   * @param {string} sessionId
   * @param {string} content — prompt text
   * @param {number} [timeoutMs=300000]
   * @param {number} [pollIntervalMs=2000]
   * @returns {Promise<import("./ndjson-parser.mjs").AgentOutputMessage[]>}
   */
  async sendAsync(sessionId, content, timeoutMs = 300_000, pollIntervalMs = 2000) {
    const session = this.#sessions.get(sessionId);
    if (!session) return [];

    if (session._api) {
      // API session: direct HTTP call with tool loop
      const msgs = await session.adapter.send(content);
      session.messages.push(...msgs);
      session.complete = msgs.some((m) => m.type === "complete");
      return msgs;
    }

    // CLI session: send + poll
    this.send(sessionId, content);

    const start = Date.now();
    const allMsgs = [];
    while (Date.now() - start < timeoutMs) {
      const newMsgs = this.capture(sessionId);
      allMsgs.push(...newMsgs);
      if (session.complete) return allMsgs;
      await new Promise((r) => setTimeout(r, pollIntervalMs));
    }
    return allMsgs;
  }

  /**
   * Capture and parse recent output from a model session.
   * For API sessions, returns any buffered messages since last capture.
   *
   * @param {string} sessionId
   * @param {number} [tailLines=200]
   * @returns {import("./ndjson-parser.mjs").AgentOutputMessage[]}
   */
  capture(sessionId, tailLines = 200) {
    const session = this.#sessions.get(sessionId);
    if (!session) return [];

    // API sessions: messages are already collected by sendAsync()
    if (session._api) {
      return [];
    }

    const result = this.#mux.capture(sessionId, tailLines);
    if (!result?.output) return [];

    const newMsgs = session.parser.feed(result.output);
    session.messages.push(...newMsgs);

    // Cap message buffer to prevent unbounded growth (keep last 500)
    if (session.messages.length > 500) {
      session.messages.splice(0, session.messages.length - 500);
    }

    // Check for completion
    if (newMsgs.some((m) => m.type === "complete")) {
      session.complete = true;
    }

    return newMsgs;
  }

  /**
   * Get the latest complete result from a model session.
   *
   * @param {string} sessionId
   * @returns {{ result: string, usage?: { input: number, output: number } }|null}
   */
  getResult(sessionId) {
    const session = this.#sessions.get(sessionId);
    if (!session) return null;

    const complete = [...session.messages].reverse().find((m) => m.type === "complete");
    return complete ? { result: complete.result, usage: complete.usage } : null;
  }

  /**
   * Spawn multiple models for deliberative consensus.
   *
   * @param {{ advocate: ModelConfig, devil: ModelConfig, judge: ModelConfig }} roles
   * @returns {Promise<{ advocate: ModelSession, devil: ModelSession, judge: ModelSession }>}
   */
  async spawnConsensus(roles) {
    const [advocate, devil, judge] = await Promise.all([
      this.spawn({ ...roles.advocate, role: "advocate" }),
      this.spawn({ ...roles.devil, role: "devil" }),
      this.spawn({ ...roles.judge, role: "judge" }),
    ]);
    return { advocate, devil, judge };
  }

  /**
   * Send a prompt to all consensus models simultaneously.
   * API sessions use sendAsync; CLI sessions use stdin.
   *
   * @param {{ advocate: ModelSession, devil: ModelSession, judge: ModelSession }} sessions
   * @param {string} prompt
   * @returns {Promise<void>}
   */
  async broadcastPrompt(sessions, prompt) {
    const promises = [];
    for (const session of Object.values(sessions)) {
      if (session._api) {
        // API sessions: fire off sendAsync (resolved in awaitConsensus)
        promises.push(
          session.adapter.send(prompt).then((msgs) => {
            session.messages.push(...msgs);
            session.complete = msgs.some((m) => m.type === "complete");
          }),
        );
      } else {
        this.send(session.sessionId, prompt);
      }
    }
    // Fire all API calls in parallel, don't await here (awaitConsensus handles it)
    if (promises.length > 0) {
      // Store promises on sessions for awaitConsensus to track
      for (let i = 0; i < promises.length; i++) {
        const apiSessions = Object.values(sessions).filter((s) => s._api);
        if (apiSessions[i]) apiSessions[i]._pending = promises[i];
      }
    }
  }

  /**
   * Poll all consensus sessions until all complete or timeout.
   * Handles both CLI (polling) and API (promise-based) sessions.
   *
   * @param {{ advocate: ModelSession, devil: ModelSession, judge: ModelSession }} sessions
   * @param {number} [timeoutMs=120000]
   * @param {number} [pollIntervalMs=2000]
   * @returns {Promise<Record<string, { result: string, usage?: { input: number, output: number } }>>}
   */
  async awaitConsensus(sessions, timeoutMs = 120_000, pollIntervalMs = 2000) {
    const start = Date.now();
    const results = {};

    // Resolve any pending API promises first
    const apiPromises = [];
    for (const [role, session] of Object.entries(sessions)) {
      if (session._pending) {
        apiPromises.push(session._pending.then(() => { delete session._pending; }));
      }
    }
    if (apiPromises.length > 0) {
      await Promise.race([
        Promise.all(apiPromises),
        new Promise((r) => setTimeout(r, timeoutMs)),
      ]);
    }

    // Collect results from all sessions (API + CLI)
    while (Date.now() - start < timeoutMs) {
      for (const [role, session] of Object.entries(sessions)) {
        if (!results[role]) {
          if (!session._api) this.capture(session.sessionId);
          if (session.complete) {
            results[role] = this.getResult(session.sessionId);
          }
        }
      }

      if (Object.keys(results).length === Object.keys(sessions).length) break;
      await new Promise((r) => setTimeout(r, pollIntervalMs));
    }

    return results;
  }

  /**
   * Kill a model session.
   * @param {string} sessionId
   */
  async kill(sessionId) {
    const session = this.#sessions.get(sessionId);
    if (session) {
      if (session.parser) session.parser.reset();
      if (session._api && session.adapter.reset) session.adapter.reset();
      this.#sessions.delete(sessionId);
    }
    // Only kill mux process for CLI sessions
    if (!session?._api) {
      await this.#mux.kill(sessionId);
    }
  }

  /**
   * Kill all model sessions.
   */
  async cleanup() {
    for (const sessionId of this.#sessions.keys()) {
      await this.kill(sessionId);
    }
  }

  /**
   * List active model sessions.
   * @returns {ModelSession[]}
   */
  list() {
    return [...this.#sessions.values()];
  }

}
