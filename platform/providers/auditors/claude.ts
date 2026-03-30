/**
 * Claude Auditor — runs audits via Anthropic Claude CLI.
 *
 * Spawns `claude -p` with the audit prompt.
 */

import { spawn, execSync } from "node:child_process";
import type { Auditor, AuditRequest, AuditResult } from "../provider.js";
import { parseAuditResponse } from "./parse.js";
import { formatAuditPrompt } from "./format-prompt.js";

const isWin = process.platform === "win32";

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
    const prompt = formatAuditPrompt(request);

    return new Promise<AuditResult>((resolve) => {
      const args = ["-p", "--model", this.model];
      // DEP0190: shell + args array triggers deprecation. Join into single string on Windows.
      const child = isWin
        ? spawn(`${this.bin} ${args.join(" ")}`, { cwd: this.cwd, stdio: ["pipe", "pipe", "pipe"], windowsHide: true, shell: true })
        : spawn(this.bin, args, { cwd: this.cwd, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });

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
            summary: `Claude CLI failed (exit ${code}): ${stderr.slice(0, 200)}`,
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
          summary: `Claude CLI error: ${err.message}`,
          raw: "",
          duration: Date.now() - start,
        });
      });
    });
  }

  async available(): Promise<boolean> {
    try {
      execSync(`${this.bin} --version`, { encoding: "utf8", timeout: 10000, windowsHide: true, stdio: "pipe" });
      return true;
    } catch (err) {
      console.warn(`[claude-auditor] availability check failed: ${(err as Error).message}`);
      return false;
    }
  }
}

// formatPrompt → shared formatAuditPrompt in format-prompt.ts
