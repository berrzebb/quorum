/**
 * Claude Auditor — runs audits via Anthropic Claude CLI.
 *
 * Spawns `claude -p` with the audit prompt.
 */

import { spawnSync } from "node:child_process";
import type { Auditor, AuditRequest, AuditResult } from "../provider.js";

export interface ClaudeAuditorConfig {
  bin?: string;
  model?: string;
  timeout?: number;
  cwd?: string;
}

export class ClaudeAuditor implements Auditor {
  private bin: string;
  private model: string;
  private timeout: number;
  private cwd: string;

  constructor(config: ClaudeAuditorConfig = {}) {
    this.bin = config.bin ?? process.env.CLAUDE_BIN ?? "claude";
    this.model = config.model ?? "claude-sonnet-4-6";
    this.timeout = config.timeout ?? 120_000;
    this.cwd = config.cwd ?? process.cwd();
  }

  async audit(request: AuditRequest): Promise<AuditResult> {
    const start = Date.now();
    const prompt = formatPrompt(request);

    const result = spawnSync(this.bin, ["-p", "--model", this.model], {
      input: prompt,
      encoding: "utf8",
      cwd: this.cwd,
      timeout: this.timeout,
      stdio: ["pipe", "pipe", "pipe"],
    });

    const raw = result.stdout ?? "";
    const duration = Date.now() - start;

    if (result.error || result.status !== 0) {
      return {
        verdict: "infra_failure",
        codes: ["auditor-error"],
        summary: `Claude CLI failed (exit ${result.status}): ${result.stderr?.slice(0, 200) ?? result.error?.message ?? "unknown"}`,
        raw: raw || result.stderr || "",
        duration,
      };
    }

    return parseResponse(raw, duration);
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

function formatPrompt(request: AuditRequest): string {
  return `${request.prompt}\n\n## Evidence\n\n${request.evidence}\n\n## Changed Files\n\n${request.files.map((f) => `- ${f}`).join("\n")}\n\nRespond with ONLY a JSON object:\n{"verdict": "approved" | "changes_requested" | "infra_failure", "codes": [], "summary": "..."}`;
}

function parseResponse(raw: string, duration: number): AuditResult {
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON");
    const parsed = JSON.parse(jsonMatch[0]);
    return {
      verdict: parsed.verdict === "approved" ? "approved" : parsed.verdict === "infra_failure" ? "infra_failure" : "changes_requested",
      codes: Array.isArray(parsed.codes) ? parsed.codes : [],
      summary: parsed.summary ?? "",
      raw,
      duration,
    };
  } catch {
    const lower = raw.toLowerCase();
    return {
      verdict: lower.includes("approved") && !lower.includes("not approved") ? "approved" : "changes_requested",
      codes: ["parse-error"],
      summary: raw.slice(0, 200),
      raw,
      duration,
    };
  }
}
