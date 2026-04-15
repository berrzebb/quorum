/**
 * MuxAuditor — Auditor implementation backed by ProcessMux sessions.
 *
 * Spawns LLM CLIs (claude, codex, gemini) as tmux/psmux sessions,
 * enabling daemon TUI observation of live deliberation.
 *
 * Each audit():
 * 1. Spawns a mux session with the provider CLI
 * 2. Saves session state to .claude/agents/ (daemon-discoverable)
 * 3. Emits agent.spawn event
 * 4. Sends prompt via mux.send()
 * 5. Polls capture() until completion or timeout
 * 6. Emits agent.complete event
 * 7. Returns parsed AuditResult
 *
 * Sessions are killed after audit completes (use --keep-sessions to retain).
 */

import { resolve, join } from "node:path";
import { existsSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { FilesystemAgentStateStore } from "../../orchestrate/state/filesystem/agent-state-store.js";
import { tmpdir, platform } from "node:os";
import { ProcessMux, type MuxSession, type MuxBackend } from "../../bus/mux.js";
import type { Auditor, AuditRequest, AuditResult } from "../provider.js";
import { extractJson } from "./parse.js";
import { parseSpec } from "./factory.js";
import { AUDIT_VERDICT } from "../../bus/events.js";

// ── Types ────────────────────────────────────

export interface MuxAuditorConfig {
  /** Provider CLI name ("claude", "codex", "gemini"). */
  provider: string;
  /** Parliament role for session naming. */
  role: "advocate" | "devil" | "judge";
  /** Working directory. */
  cwd: string;
  /** Shared ProcessMux instance (reused across all 3 auditors). */
  mux: ProcessMux;
  /** Model override. */
  model?: string;
  /** Poll interval in ms (default: 2000). */
  pollIntervalMs?: number;
  /** Audit timeout in ms (default: 300000 = 5 min). */
  timeoutMs?: number;
  /** Keep mux session alive after audit (for debugging). */
  keepSession?: boolean;
  /** Called with new text chunks during deliberation (for live streaming). */
  onProgress?: (chunk: string) => void;
}

// ── Agent state persistence ─────────────────

function agentStore(cwd: string): FilesystemAgentStateStore {
  return new FilesystemAgentStateStore(resolve(cwd, ".claude", "agents"));
}

// ── CLI argument builders ───────────────────

/** Providers that require CLI spawn (have a native CLI tool). */
const CLI_PROVIDERS = new Set(["claude", "codex", "gemini"]);

/** Providers that use HTTP API (no CLI binary). */
const API_PROVIDERS = new Set(["ollama", "vllm", "openai", "anthropic"]);

export function buildArgs(provider: string, model?: string): string[] {
  if (API_PROVIDERS.has(provider)) {
    throw new Error(
      `MuxAuditor does not support API provider "${provider}". ` +
      `Use the auditor directly (e.g. createAuditor("${provider}")) or MuxAdapter.spawn() which auto-routes API providers.`,
    );
  }
  switch (provider) {
    case "claude":
      return ["-p", "--output-format", "stream-json", "--dangerously-skip-permissions", ...(model ? ["--model", model] : [])];
    case "codex":
      return ["exec", "--json", "--full-auto", ...(model ? ["--model", model] : []), "-"];
    case "gemini":
      return ["-p", "--output-format", "stream-json", ...(model ? ["--model", model] : [])];
    default:
      return ["-p"];
  }
}

/**
 * Write prompt to temp file for cleanup tracking.
 * The actual delivery happens via send-keys + C-d (EOF) in the audit method.
 */
function writePromptFile(prompt: string, sessionName: string): string {
  const promptFile = join(tmpdir(), `quorum-prompt-${sessionName}.txt`);
  writeFileSync(promptFile, prompt, "utf8");
  return promptFile;
}

// ── MuxAuditor ──────────────────────────────

export class MuxAuditor implements Auditor {
  private config: MuxAuditorConfig;

  constructor(config: MuxAuditorConfig) {
    this.config = config;
  }

  async audit(request: AuditRequest): Promise<AuditResult> {
    const { provider, role, cwd, mux, model, keepSession } = this.config;
    const pollInterval = this.config.pollIntervalMs ?? 2000;
    const timeout = this.config.timeoutMs ?? 300_000;
    const start = Date.now();
    const backend = mux.getBackend();

    // 1. Spawn mux session
    // For psmux/tmux: pipe prompt via temp file (mux.send() can't deliver EOF)
    // For raw: use direct stdin pipe via mux.send()
    const sessionName = `quorum-parl-${role}-${Date.now()}`;
    let session: MuxSession;
    let promptFile: string | undefined;

    try {
      if (backend === "raw") {
        // Raw: spawn claude directly, pipe stdin
        session = await mux.spawn({
          name: sessionName,
          command: provider,
          args: buildArgs(provider, model),
          cwd,
          env: { FEEDBACK_LOOP_ACTIVE: "1" },
        });
      } else {
        // psmux/tmux: spawn default shell (detached), then send a pipe command
        // This avoids terminal stdin buffer issues with long prompts
        promptFile = writePromptFile(request.prompt, sessionName);
        session = await mux.spawn({
          name: sessionName,
          command: "",  // empty = use default shell (pwsh on Windows, bash on Unix)
          args: [],
          cwd,
          env: { FEEDBACK_LOOP_ACTIVE: "1" },
        });
      }
    } catch (err) {
      if (promptFile) cleanupPromptFile(promptFile);
      return infraFailure(`Failed to spawn ${provider}: ${(err as Error).message}`, start);
    }

    if (session.status === "error") {
      if (promptFile) cleanupPromptFile(promptFile);
      return infraFailure(`Mux session failed to start for ${role} (backend: ${backend})`, start);
    }

    // 2. Compute outputFile path before saving state (daemon needs it for live output)
    const outputFile = promptFile?.replace(/\.txt$/, ".out");

    // 3. Save agent state (daemon-discoverable — includes outputFile)
    agentStore(cwd).save({
      id: session.id,
      name: session.name,
      backend: session.backend,
      role,
      type: "parliament",
      startedAt: session.startedAt,
      status: session.status,
      outputFile,
    });

    // 4. Send prompt
    if (backend === "raw") {
      // Raw: direct stdin pipe
      const sent = mux.send(session.id, request.prompt);
      if (!sent) {
        agentStore(cwd).remove(session.id);
        return infraFailure(`Failed to send prompt to ${role}`, start);
      }
    } else {
      // psmux/tmux: write a script that pipes prompt to claude AND saves output to file.
      // capture-pane is unreliable (padding, truncation) — use output file for parsing.
      const cliArgs = buildArgs(provider, model).join(" ");
      const isWin = platform() === "win32";
      const escapedPath = promptFile!.replace(/\//g, "\\");
      const scriptFile = promptFile!.replace(/\.txt$/, isWin ? ".cmd" : ".sh");

      if (isWin) {
        writeFileSync(scriptFile, `@type "${escapedPath}" | ${provider} ${cliArgs} > "${outputFile!.replace(/\//g, "\\")}" 2>&1\n`, "utf8");
      } else {
        writeFileSync(scriptFile, `#!/bin/sh\ncat '${promptFile}' | ${provider} ${cliArgs} > '${outputFile}' 2>&1\n`, { mode: 0o755 });
      }

      await sleep(3000);
      mux.send(session.id, isWin ? `& "${scriptFile.replace(/\//g, "\\")}"` : `"${scriptFile}"`);
    }

    // 5. Poll until completion or timeout
    // For mux backends: read from OUTPUT FILE (not capture-pane, which truncates/pads).
    // For raw backend: read from capture (in-memory buffer).
    let raw = "";
    let completed = false;
    const debug = !!process.env.QUORUM_DEBUG;
    const { onProgress } = this.config;
    let lastStreamedLen = 0;

    if (debug) console.error(`[mux-audit] ${role}: session ${session.name}, backend ${backend}, polling...`);

    while (Date.now() - start < timeout) {
      await sleep(pollInterval);

      let pollOutput = "";
      if (backend === "raw") {
        const capture = mux.capture(session.id, 500);
        if (!capture) continue;
        pollOutput = capture.output;
      } else if (outputFile && existsSync(outputFile)) {
        try { pollOutput = readFileSync(outputFile, "utf8"); } catch (err) { continue; }
      } else {
        continue;
      }

      // Stream new text to caller for live visibility
      if (onProgress && pollOutput.length > lastStreamedLen) {
        const currentText = extractAssistantText(pollOutput) ?? "";
        if (currentText.length > lastStreamedLen) {
          onProgress(currentText.slice(lastStreamedLen));
          lastStreamedLen = currentText.length;
        }
      }

      if (debug) {
        const nonEmpty = pollOutput.replace(/\s/g, "").length;
        console.error(`[mux-audit] ${role}: poll ${pollOutput.length} chars, ${nonEmpty} non-ws, complete=${isComplete(pollOutput, provider)}`);
      }

      if (isComplete(pollOutput, provider)) {
        raw = pollOutput;
        completed = true;
        break;
      }

      raw = pollOutput;
    }

    // 5. Cleanup
    agentStore(cwd).remove(session.id);
    if (promptFile) {
      cleanupPromptFile(promptFile);
      cleanupPromptFile(promptFile.replace(/\.txt$/, platform() === "win32" ? ".cmd" : ".sh"));
      cleanupPromptFile(promptFile.replace(/\.txt$/, ".out"));
    }
    if (!keepSession) {
      try { await mux.kill(session.id); } catch { /* session may already be dead */ }
    }

    const duration = Date.now() - start;

    if (!completed) {
      return infraFailure(`Audit timeout after ${timeout}ms`, start);
    }

    // 6. Parse result
    return parseAuditOutput(raw, duration);
  }

  async available(): Promise<boolean> {
    // Check if mux backend is available (not raw fallback)
    return this.config.mux.getBackend() !== "raw";
  }

  /** Get the mux session name pattern for this auditor. */
  get sessionPattern(): string {
    return `quorum-parl-${this.config.role}-*`;
  }
}

// ── Helpers ──────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

function cleanupPromptFile(path: string): void {
  try { rmSync(path, { force: true }); } catch { /* temp file — OS will clean up */ }
}

function infraFailure(message: string, start: number): AuditResult {
  return {
    verdict: AUDIT_VERDICT.INFRA_FAILURE,
    codes: ["mux-auditor-error"],
    summary: message,
    raw: "",
    duration: Date.now() - start,
  };
}

export function isComplete(raw: string, provider: string): boolean {
  // API providers don't use MuxAuditor (they use MuxAdapter API sessions).
  // Guard here in case someone passes one by mistake.
  if (API_PROVIDERS.has(provider)) return true;

  // Terminal wraps long JSON lines and capture-pane pads with spaces.
  // trimEnd each line before joining to avoid broken tokens.
  const flat = raw.split(/\r?\n/).map(l => l.trimEnd()).join("");
  switch (provider) {
    case "claude":
      return flat.includes('"type":"result","subtype":"success"') || flat.includes('"type":"result","subtype":"error"');
    case "codex":
      return flat.includes('"type":"turn.completed"');
    case "gemini":
      return flat.includes('"type":"result","subtype":"success"');
    default:
      return /\{"verdict"\s*:/.test(flat);
  }
}

export function parseAuditOutput(raw: string, duration: number): AuditResult {
  // Capture output is NDJSON (stream-json). Extract the assistant's response text
  // from "result" events or "assistant" message content blocks.
  const assistantText = extractAssistantText(raw);
  const textToParse = assistantText || raw;

  try {
    const json = extractJson(textToParse);
    if (!json) {
      return {
        verdict: AUDIT_VERDICT.CHANGES_REQUESTED,
        codes: ["parse-error"],
        summary: "Could not extract JSON from auditor output",
        raw: textToParse,
        duration,
      };
    }
    const parsed = JSON.parse(json);
    return {
      verdict: parsed.verdict === AUDIT_VERDICT.APPROVED ? AUDIT_VERDICT.APPROVED
        : parsed.verdict === AUDIT_VERDICT.INFRA_FAILURE ? AUDIT_VERDICT.INFRA_FAILURE
        : AUDIT_VERDICT.CHANGES_REQUESTED,
      codes: Array.isArray(parsed.codes) ? parsed.codes : [],
      summary: parsed.summary ?? parsed.reasoning ?? "",
      raw: textToParse,
      duration,
    };
  } catch (err) {
    console.warn(`[mux-auditor] audit output parse failed: ${(err as Error).message}`);
    return {
      verdict: AUDIT_VERDICT.CHANGES_REQUESTED,
      codes: ["parse-error"],
      summary: "Failed to parse auditor output",
      raw: textToParse,
      duration,
    };
  }
}

/**
 * Extract the assistant's text from NDJSON stream-json output.
 * Looks for {"type":"result","result":"..."} or assembles from content_block_delta.
 */
export function extractAssistantText(raw: string): string | null {
  // Strip ANSI escape codes and control characters before parsing.
  const stripped = raw
    .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "")   // ANSI escape sequences
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "");  // control chars (keep \t \n \r)

  // Path 1: Clean NDJSON (file-based output — one JSON per line).
  // stream-json output from claude/codex/gemini is proper NDJSON.
  const ndjsonResult = extractFromNdjsonLines(stripped);
  if (ndjsonResult !== null) return ndjsonResult;

  // Path 2: Terminal capture fallback (tmux capture-pane wraps/pads lines).
  // Join all lines into one string, then re-split by {"type": lookahead.
  return extractFromJoinedCapture(stripped);
}

/**
 * Parse NDJSON line-by-line — fast path for file-based output.
 *
 * Wire formats (from cli-adapter.mjs):
 *   Claude: {"type":"result","result":"..."} / {"type":"content_block_delta","delta":{"text":"..."}}
 *   Codex:  {"type":"item.completed","item":{"type":"agent_message","text":"..."}} / {"type":"turn.completed"}
 *   Gemini: {"type":"result","result":"..."} (same as Claude)
 */
function extractFromNdjsonLines(stripped: string): string | null {
  const lines = stripped.split(/\r?\n/);
  const objects: Array<Record<string, unknown>> = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.startsWith("{")) continue;
    try {
      objects.push(JSON.parse(trimmed));
    } catch { /* skip malformed lines, try others */ }
  }

  if (objects.length === 0) return null;

  // Claude/Gemini: "result" event with final text
  for (const obj of objects) {
    if (obj.type === "result" && typeof obj.result === "string" && (obj.result as string).length > 10) {
      return obj.result as string;
    }
  }

  // Codex: "item.completed" with agent_message — last one wins (accumulates)
  let codexText = "";
  for (const obj of objects) {
    if (obj.type === "item.completed") {
      const item = obj.item as Record<string, unknown> | undefined;
      if (item?.type === "agent_message" && typeof item.text === "string") {
        codexText = item.text as string;
      }
    }
  }
  if (codexText.length > 10) return codexText;

  // Claude: assemble from content_block_delta text deltas
  const parts: string[] = [];
  for (const obj of objects) {
    if (obj.type === "content_block_delta" && (obj.delta as Record<string, unknown>)?.text) {
      parts.push((obj.delta as Record<string, unknown>).text as string);
    }
  }

  return parts.length > 0 ? parts.join("") : null;
}

/** Fallback: join lines and split by regex — for terminal capture (padded/wrapped lines). */
function extractFromJoinedCapture(stripped: string): string | null {
  const joined = stripped.split(/\r?\n/).map(l => l.trimEnd()).join("");
  const entries = joined.split(/(?=\{"type":)/);

  // Claude/Gemini: "result" event
  for (const entry of entries) {
    try {
      const obj = JSON.parse(entry);
      if (obj.type === "result" && typeof obj.result === "string" && obj.result.length > 10) {
        return obj.result;
      }
    } catch { /* expected — regex split produces fragments */ }
  }

  // Codex: "item.completed" with agent_message
  let codexText = "";
  for (const entry of entries) {
    try {
      const obj = JSON.parse(entry);
      if (obj.type === "item.completed" && obj.item?.type === "agent_message" && typeof obj.item.text === "string") {
        codexText = obj.item.text;
      }
    } catch { /* expected */ }
  }
  if (codexText.length > 10) return codexText;

  // Claude: content_block_delta assembly
  const parts: string[] = [];
  for (const entry of entries) {
    try {
      const obj = JSON.parse(entry);
      if (obj.type === "content_block_delta" && obj.delta?.text) {
        parts.push(obj.delta.text);
      }
    } catch { /* expected */ }
  }

  return parts.length > 0 ? parts.join("") : null;
}

// ── Factory helper ──────────────────────────

/**
 * Create 3 MuxAuditors for parliament consensus.
 * Shares a single ProcessMux instance across all 3 roles.
 */
export function createMuxConsensusAuditors(
  roles: Record<string, string>,
  cwd: string,
  mux: ProcessMux,
  options?: { pollIntervalMs?: number; timeoutMs?: number; keepSession?: boolean; onProgress?: (role: string, chunk: string) => void },
): { advocate: Auditor; devil: Auditor; judge: Auditor } {
  const makeAuditor = (role: "advocate" | "devil" | "judge"): MuxAuditor => {
    const { provider, model } = parseSpec(roles[role] ?? "claude");
    return new MuxAuditor({
      provider,
      role,
      cwd,
      mux,
      model,
      ...options,
      onProgress: options?.onProgress ? (chunk: string) => options.onProgress!(role, chunk) : undefined,
    });
  };

  return {
    advocate: makeAuditor("advocate"),
    devil: makeAuditor("devil"),
    judge: makeAuditor("judge"),
  };
}
