/**
 * Codex Auditor — runs audits via OpenAI Codex CLI.
 *
 * Spawns `codex exec` with the audit prompt and parses the response.
 * Supports model lane configuration via env vars or config.
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { Auditor, AuditRequest, AuditResult } from "../provider.js";

export interface CodexAuditorConfig {
  /** Path to codex binary (default: "codex", resolved from PATH). */
  bin?: string;
  /** Model to use (default: from CODEX_MODEL env or "codex"). */
  model?: string;
  /** Timeout in ms (default: 120000). */
  timeout?: number;
  /** Working directory for codex execution. */
  cwd?: string;
}

export class CodexAuditor implements Auditor {
  private bin: string;
  private model: string;
  private timeout: number;
  private cwd: string;

  constructor(config: CodexAuditorConfig = {}) {
    this.bin = config.bin ?? process.env.CODEX_BIN ?? "codex";
    this.model = config.model ?? process.env.CODEX_MODEL ?? "codex";
    this.timeout = config.timeout ?? 120_000;
    this.cwd = config.cwd ?? process.cwd();
  }

  async audit(request: AuditRequest): Promise<AuditResult> {
    const start = Date.now();
    const prompt = buildCodexPrompt(request);

    const result = spawnSync(this.bin, ["exec", prompt], {
      encoding: "utf8",
      cwd: this.cwd,
      timeout: this.timeout,
      shell: process.platform === "win32",
      env: {
        ...process.env,
        CODEX_MODEL: this.model,
      },
    });

    const raw = result.stdout ?? "";
    const duration = Date.now() - start;

    if (result.error || result.status !== 0) {
      return {
        verdict: "changes_requested",
        codes: ["auditor-error"],
        summary: `Codex exec failed: ${result.stderr?.slice(0, 200) ?? result.error?.message ?? "unknown"}`,
        raw: raw || result.stderr || "",
        duration,
      };
    }

    return parseCodexResponse(raw, duration);
  }

  async available(): Promise<boolean> {
    try {
      const result = spawnSync(this.bin, ["--version"], {
        encoding: "utf8",
        timeout: 5000,
      });
      return result.status === 0;
    } catch {
      return false;
    }
  }
}

function buildCodexPrompt(request: AuditRequest): string {
  return `${request.prompt}

## Evidence

${request.evidence}

## Changed Files

${request.files.map((f) => `- ${f}`).join("\n")}

## Response Format

Respond with ONLY a JSON object:
{
  "verdict": "approved" | "changes_requested",
  "codes": ["rejection-code-if-any"],
  "summary": "your analysis"
}`;
}

function parseCodexResponse(raw: string, duration: number): AuditResult {
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON found");

    const parsed = JSON.parse(jsonMatch[0]);
    return {
      verdict: parsed.verdict === "approved" ? "approved" : "changes_requested",
      codes: Array.isArray(parsed.codes) ? parsed.codes : [],
      summary: parsed.summary ?? "",
      raw,
      duration,
    };
  } catch {
    // Heuristic fallback: look for keywords
    const lower = raw.toLowerCase();
    const approved = lower.includes("approved") && !lower.includes("not approved");
    return {
      verdict: approved ? "approved" : "changes_requested",
      codes: approved ? [] : ["parse-error"],
      summary: raw.slice(0, 200),
      raw,
      duration,
    };
  }
}
