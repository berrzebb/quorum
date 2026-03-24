/**
 * MuxAdapter — bridges ProcessMux sessions with CliAdapter/NdjsonParser.
 *
 * Spawns CLI processes (Claude, Codex, Gemini) in tmux/psmux sessions,
 * parses their NDJSON output through CliAdapter, and enables real-time
 * cross-model communication via ProcessMux.send().
 *
 * Architecture:
 *   ProcessMux.spawn()  → tmux session per model
 *   ProcessMux.capture() → NdjsonParser.feed() → AgentOutputMessage[]
 *   ProcessMux.send()    → CliAdapter.formatInput() → model stdin
 *
 * @module adapters/shared/mux-adapter
 */

import { NdjsonParser } from "./ndjson-parser.mjs";
import { createCliAdapter } from "./cli-adapter.mjs";

/**
 * @typedef {{ provider: string, role?: string, model?: string, systemPrompt?: string, allowedTools?: string[], mcpConfig?: string }} ModelConfig
 *
 * @typedef {{ sessionId: string, provider: string, role: string, adapter: import("./cli-adapter.mjs").ClaudeCliAdapter|import("./cli-adapter.mjs").CodexCliAdapter|import("./cli-adapter.mjs").GeminiCliAdapter, parser: NdjsonParser, messages: import("./ndjson-parser.mjs").AgentOutputMessage[], complete: boolean }} ModelSession
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
   * Spawn a model in a mux session.
   *
   * @param {ModelConfig} config
   * @returns {Promise<ModelSession>}
   */
  async spawn(config) {
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
    };

    this.#sessions.set(muxSession.id, session);
    return session;
  }

  /**
   * Send a prompt to a model session.
   *
   * @param {string} sessionId
   * @param {string} content — prompt text
   * @returns {boolean}
   */
  send(sessionId, content) {
    const session = this.#sessions.get(sessionId);
    if (!session) return false;

    const formatted = session.adapter.formatInput({ type: "user_message", content });
    return this.#mux.send(sessionId, formatted.trim());
  }

  /**
   * Capture and parse recent output from a model session.
   *
   * @param {string} sessionId
   * @param {number} [tailLines=200]
   * @returns {import("./ndjson-parser.mjs").AgentOutputMessage[]}
   */
  capture(sessionId, tailLines = 200) {
    const session = this.#sessions.get(sessionId);
    if (!session) return [];

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
   *
   * @param {{ advocate: ModelSession, devil: ModelSession, judge: ModelSession }} sessions
   * @param {string} prompt
   */
  broadcastPrompt(sessions, prompt) {
    for (const session of Object.values(sessions)) {
      this.send(session.sessionId, prompt);
    }
  }

  /**
   * Poll all consensus sessions until all complete or timeout.
   *
   * @param {{ advocate: ModelSession, devil: ModelSession, judge: ModelSession }} sessions
   * @param {number} [timeoutMs=120000]
   * @param {number} [pollIntervalMs=2000]
   * @returns {Promise<Record<string, { result: string, usage?: { input: number, output: number } }>>}
   */
  async awaitConsensus(sessions, timeoutMs = 120_000, pollIntervalMs = 2000) {
    const start = Date.now();
    const results = {};

    while (Date.now() - start < timeoutMs) {
      for (const [role, session] of Object.entries(sessions)) {
        if (!results[role]) {
          this.capture(session.sessionId);
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
      session.parser.reset();
      this.#sessions.delete(sessionId);
    }
    await this.#mux.kill(sessionId);
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
