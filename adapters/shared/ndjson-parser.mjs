/**
 * Stream-based NDJSON parser with buffer overflow guard.
 *
 * Ported from SoulFlow-Orchestrator src/agent/pty/ndjson-parser.ts.
 * Feeds raw stream chunks, outputs parsed messages via adapter.parse_output().
 *
 * @module adapters/shared/ndjson-parser
 */

/** Buffer max size (bytes). Overflow → discard to prevent OOM. */
const MAX_BUFFER_BYTES = 10 * 1024 * 1024; // 10MB

/**
 * @typedef {{ type: "assistant_chunk", content: string, delta: true }} AssistantChunkMsg
 * @typedef {{ type: "tool_use", tool: string, input: unknown }} ToolUseMsg
 * @typedef {{ type: "tool_result", tool: string, output: string }} ToolResultMsg
 * @typedef {{ type: "complete", result: string, usage?: { input: number, output: number } }} CompleteMsg
 * @typedef {{ type: "error", code: string, message: string }} ErrorMsg
 * @typedef {AssistantChunkMsg | ToolUseMsg | ToolResultMsg | CompleteMsg | ErrorMsg} AgentOutputMessage
 *
 * @typedef {{ parse_output(line: string): AgentOutputMessage|AgentOutputMessage[]|null }} CliAdapterLike
 */

export class NdjsonParser {
  /** @type {string} */
  #buffer = "";
  /** @type {CliAdapterLike} */
  #adapter;

  /** @param {CliAdapterLike} adapter — CLI-specific NDJSON parser */
  constructor(adapter) {
    this.#adapter = adapter;
  }

  /**
   * Feed a raw stream chunk. Returns parsed messages.
   * @param {string} chunk
   * @returns {AgentOutputMessage[]}
   */
  feed(chunk) {
    this.#buffer += chunk;
    if (this.#buffer.length > MAX_BUFFER_BYTES) {
      this.#buffer = "";
      return [{ type: "error", code: "buffer_overflow", message: "ndjson buffer overflow — discarding" }];
    }

    const results = [];
    // Single-pass split (avoids O(n*m) repeated front-slicing)
    const lines = this.#buffer.split("\n");
    this.#buffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const msg = this.#adapter.parse_output(line);
      if (msg) {
        if (Array.isArray(msg)) results.push(...msg);
        else results.push(msg);
      }
    }
    return results;
  }

  /** Flush remaining buffer. */
  flush() {
    if (!this.#buffer.trim()) { this.#buffer = ""; return []; }
    const msg = this.#adapter.parse_output(this.#buffer);
    this.#buffer = "";
    if (!msg) return [];
    return Array.isArray(msg) ? msg : [msg];
  }

  reset() { this.#buffer = ""; }
}
