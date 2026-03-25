/**
 * Gemini Auditor — runs audits via Gemini CLI (`gemini`).
 *
 * Uses the installed `gemini` CLI with login-based auth (OAuth).
 * Same pattern as ClaudeAuditor: spawn CLI, pipe prompt via stdin.
 */

import { spawn, spawnSync, execSync } from "node:child_process";
import type { Auditor, AuditRequest, AuditResult } from "../provider.js";
import { parseAuditResponse } from "./parse.js";

const isWin = process.platform === "win32";

export interface GeminiAuditorConfig {
  bin?: string;
  model?: string;
  timeout?: number;
  cwd?: string;
}

export class GeminiAuditor implements Auditor {
  private bin: string;
  private model: string;
  private timeout: number;
  private cwd: string;

  constructor(config: GeminiAuditorConfig = {}) {
    this.bin = config.bin ?? process.env.GEMINI_BIN ?? "gemini";
    this.model = config.model ?? "gemini-2.5-flash";
    this.timeout = config.timeout ?? 120_000;
    this.cwd = config.cwd ?? process.cwd();
  }

  async audit(request: AuditRequest): Promise<AuditResult> {
    const start = Date.now();
    const prompt = formatPrompt(request);

    return new Promise<AuditResult>((resolve) => {
      // Gemini CLI: pipe prompt via stdin + -p flag (no value = read from stdin)
      // Long prompts as -p arg fail due to shell escaping and arg length limits
      const child = spawn(this.bin, ["-m", this.model], {
        cwd: this.cwd,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
        shell: isWin,
      });

      child.stdin.write(prompt);
      child.stdin.end();

      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
      child.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });

      const timer = setTimeout(() => { child.kill(); }, this.timeout);

      child.on("close", (code) => {
        clearTimeout(timer);
        const duration = Date.now() - start;
        if (code !== 0) {
          resolve({
            verdict: "infra_failure",
            codes: ["auditor-error"],
            summary: `Gemini CLI failed (exit ${code}): ${stderr.slice(0, 200)}`,
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
          summary: `Gemini CLI error: ${err.message}`,
          raw: "",
          duration: Date.now() - start,
        });
      });
    });
  }

  async available(): Promise<boolean> {
    try {
      // execSync handles Windows npm shims (.cmd) correctly
      execSync(`${this.bin} --version`, { encoding: "utf8", timeout: 10000, windowsHide: true, stdio: "pipe" });
      return true;
    } catch {
      return false;
    }
  }
}

function formatPrompt(request: AuditRequest): string {
  return `${request.prompt}\n\n## Evidence\n\n${request.evidence}\n\n## Changed Files\n\n${request.files.map((f) => `- ${f}`).join("\n")}\n\nRespond with ONLY a JSON object:\n{"verdict": "approved" | "changes_requested" | "infra_failure", "codes": [], "summary": "..."}`;
}
