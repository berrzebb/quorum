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

import { resolve } from "node:path";
import { existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { ProcessMux, type MuxSession, type MuxBackend } from "../../bus/mux.js";
import type { Auditor, AuditRequest, AuditResult } from "../provider.js";
import { extractJson } from "./parse.js";

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
  /** Audit timeout in ms (default: 120000). */
  timeoutMs?: number;
  /** Keep mux session alive after audit (for debugging). */
  keepSession?: boolean;
}

// ── Agent state persistence ─────────────────

function agentsDir(cwd: string): string {
  const dir = resolve(cwd, ".claude", "agents");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function saveAgentState(cwd: string, session: MuxSession, role: string): void {
  const dir = agentsDir(cwd);
  const state = {
    id: session.id,
    name: session.name,
    pid: session.pid,
    backend: session.backend,
    role,
    type: "parliament",
    startedAt: session.startedAt,
    status: session.status,
  };
  writeFileSync(resolve(dir, `${session.id}.json`), JSON.stringify(state, null, 2), "utf8");
}

function removeAgentState(cwd: string, sessionId: string): void {
  try { rmSync(resolve(agentsDir(cwd), `${sessionId}.json`), { force: true }); } catch { /* ok */ }
}

// ── CLI argument builders ───────────────────

function buildArgs(provider: string, model?: string): string[] {
  switch (provider) {
    case "claude":
      return ["-p", "--output-format", "stream-json", ...(model ? ["--model", model] : [])];
    case "codex":
      return ["exec", "--json", ...(model ? ["--model", model] : []), "-"];
    case "gemini":
      return ["-p", "--output-format", "stream-json", ...(model ? ["--model", model] : [])];
    default:
      return ["-p"];
  }
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
    const timeout = this.config.timeoutMs ?? 120_000;
    const start = Date.now();

    // 1. Spawn mux session
    const sessionName = `quorum-parl-${role}-${Date.now()}`;
    let session: MuxSession;
    try {
      session = await mux.spawn({
        name: sessionName,
        command: provider,
        args: buildArgs(provider, model),
        cwd,
        env: { FEEDBACK_LOOP_ACTIVE: "1" },
      });
    } catch (err) {
      return infraFailure(`Failed to spawn ${provider}: ${(err as Error).message}`, start);
    }

    // 2. Save agent state (daemon-discoverable)
    saveAgentState(cwd, session, role);

    // 3. Send prompt
    const sent = mux.send(session.id, request.prompt);
    if (!sent) {
      removeAgentState(cwd, session.id);
      return infraFailure(`Failed to send prompt to ${role}`, start);
    }

    // 4. Poll until completion or timeout
    let raw = "";
    let completed = false;

    while (Date.now() - start < timeout) {
      await sleep(pollInterval);

      const capture = mux.capture(session.id, 500);
      if (!capture) continue;

      raw = capture.output;

      // Check for completion signals
      if (isComplete(raw, provider)) {
        completed = true;
        break;
      }
    }

    // 5. Cleanup
    removeAgentState(cwd, session.id);
    if (!keepSession) {
      try { await mux.kill(session.id); } catch { /* ok */ }
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

function infraFailure(message: string, start: number): AuditResult {
  return {
    verdict: "infra_failure",
    codes: ["mux-auditor-error"],
    summary: message,
    raw: "",
    duration: Date.now() - start,
  };
}

function isComplete(raw: string, provider: string): boolean {
  // Check for provider-specific completion markers in NDJSON output
  switch (provider) {
    case "claude":
      return raw.includes('"type":"result"') || raw.includes('"stop_reason"');
    case "codex":
      return raw.includes('"type":"turn.completed"');
    case "gemini":
      return raw.includes('"type":"result"');
    default:
      // Fallback: look for JSON verdict in output
      return /\{"verdict"\s*:/.test(raw);
  }
}

function parseAuditOutput(raw: string, duration: number): AuditResult {
  try {
    const json = extractJson(raw);
    if (!json) {
      return {
        verdict: "changes_requested",
        codes: ["parse-error"],
        summary: "Could not extract JSON from auditor output",
        raw,
        duration,
      };
    }
    const parsed = JSON.parse(json);
    return {
      verdict: parsed.verdict === "approved" ? "approved"
        : parsed.verdict === "infra_failure" ? "infra_failure"
        : "changes_requested",
      codes: Array.isArray(parsed.codes) ? parsed.codes : [],
      summary: parsed.summary ?? parsed.reasoning ?? "",
      raw,
      duration,
    };
  } catch {
    return {
      verdict: "changes_requested",
      codes: ["parse-error"],
      summary: "Failed to parse auditor output",
      raw,
      duration,
    };
  }
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
  options?: { pollIntervalMs?: number; timeoutMs?: number; keepSession?: boolean },
): { advocate: Auditor; devil: Auditor; judge: Auditor } {
  const makeAuditor = (role: "advocate" | "devil" | "judge"): MuxAuditor => {
    const spec = roles[role] ?? "claude";
    const [provider, ...rest] = spec.split(":");
    return new MuxAuditor({
      provider: provider!,
      role,
      cwd,
      mux,
      model: rest.length > 0 ? rest.join(":") : undefined,
      ...options,
    });
  };

  return {
    advocate: makeAuditor("advocate"),
    devil: makeAuditor("devil"),
    judge: makeAuditor("judge"),
  };
}
