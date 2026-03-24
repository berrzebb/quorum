/**
 * Codex Auditor — runs audits via OpenAI Codex CLI.
 *
 * Spawns `codex exec` with the audit prompt and parses the response.
 * Supports model lane configuration via env vars or config.
 */

import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { Auditor, AuditRequest, AuditResult } from "../provider.js";
import { parseAuditResponse } from "../auditors/parse.js";

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
  private needsShell: boolean;

  constructor(config: CodexAuditorConfig = {}) {
    // On Windows, prefer .cmd wrapper to prevent Git Bash msys-2.0.dll crash
    let defaultBin = "codex";
    if (process.platform === "win32") {
      for (const ext of [".cmd", ".exe", ".bat"]) {
        try {
          const r = spawnSync("where", [`codex${ext}`], { encoding: "utf8", timeout: 3000, windowsHide: true });
          if (r.status === 0) { defaultBin = r.stdout.trim().split("\n")[0]!; break; }
        } catch { /* skip */ }
      }
    }
    this.bin = config.bin ?? process.env.CODEX_BIN ?? defaultBin;
    this.model = config.model ?? process.env.CODEX_MODEL ?? "codex";
    this.timeout = config.timeout ?? 120_000;
    this.cwd = config.cwd ?? process.cwd();
    this.needsShell = process.platform === "win32" && /\.(cmd|bat)$/i.test(this.bin);
  }

  async audit(request: AuditRequest): Promise<AuditResult> {
    const start = Date.now();
    const prompt = buildCodexPrompt(request);

    return new Promise<AuditResult>((resolve) => {
      const child = spawn(this.bin, ["exec", "-"], {
        cwd: this.cwd,
        shell: this.needsShell,
        env: { ...process.env, CODEX_MODEL: this.model },
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });

      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
      child.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
      child.stdin.write(prompt);
      child.stdin.end();

      const timer = setTimeout(() => { child.kill(); }, this.timeout);

      child.on("close", (code) => {
        clearTimeout(timer);
        const duration = Date.now() - start;
        if (code !== 0) {
          resolve({
            verdict: "infra_failure",
            codes: ["auditor-error"],
            summary: `Codex exec failed (exit ${code}): ${stderr.slice(0, 200)}`,
            raw: stdout || stderr,
            duration,
          });
        } else {
          resolve(parseAuditResponse(stdout, duration));
        }
      });

      child.on("error", (err) => {
        clearTimeout(timer);
        resolve({
          verdict: "infra_failure",
          codes: ["auditor-error"],
          summary: `Codex error: ${err.message}`,
          raw: "",
          duration: Date.now() - start,
        });
      });
    });
  }

  async available(): Promise<boolean> {
    try {
      const result = spawnSync(this.bin, ["--version"], {
        encoding: "utf8",
        timeout: 5000,
        shell: this.needsShell,
        windowsHide: true,
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
  "verdict": "approved" | "changes_requested" | "infra_failure",
  "codes": ["rejection-code-if-any"],
  "summary": "your analysis"
}`;
}

