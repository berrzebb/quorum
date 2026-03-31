/**
 * Codex Plugin Auditor — delegates audits to codex-plugin-cc.
 *
 * Uses codex-plugin-cc's `codex-companion.mjs task` command instead of
 * directly spawning `codex exec`. This provides:
 * - Broker-based session management (persistent, multiplexed)
 * - Structured output validation
 * - Thread persistence and resume
 * - GPT-5.4 optimized prompting
 *
 * Falls back to the original CodexAuditor when codex-plugin-cc is unavailable.
 */

import { spawn } from "node:child_process";
import type { Auditor, AuditRequest, AuditResult } from "../provider.js";
import { isCodexPluginAvailable, getCompanionScriptPath } from "./broker-detect.js";
import { buildCompanionPrompt, parsePluginOutput, mapPluginVerdict } from "./plugin-bridge.js";
import { parseAuditResponse } from "../auditors/parse.js";

export interface CodexPluginAuditorConfig {
  /** Model to use (optional, codex-plugin-cc default if omitted). */
  model?: string;
  /** Timeout in ms (default: 180000 — longer than CodexAuditor for broker startup). */
  timeout?: number;
  /** Working directory for codex execution. */
  cwd?: string;
}

export class CodexPluginAuditor implements Auditor {
  private model: string | undefined;
  private timeout: number;
  private cwd: string;

  constructor(config: CodexPluginAuditorConfig = {}) {
    this.model = config.model;
    this.timeout = config.timeout ?? 180_000;
    this.cwd = config.cwd ?? process.cwd();
  }

  async audit(request: AuditRequest): Promise<AuditResult> {
    const start = Date.now();
    const companionPath = getCompanionScriptPath();

    if (!companionPath) {
      return {
        verdict: "infra_failure",
        codes: ["codex-plugin-unavailable"],
        summary: "codex-plugin-cc companion script not found",
        raw: "",
        duration: Date.now() - start,
      };
    }

    const prompt = buildCompanionPrompt(request);

    // Build args for codex-companion.mjs task
    const args = [companionPath, "task"];
    if (this.model) {
      args.push("--model", this.model);
    }
    args.push("--json"); // Request JSON output for status tracking

    return new Promise<AuditResult>((resolve) => {
      const child = spawn(process.execPath, args, {
        cwd: this.cwd,
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env },
        windowsHide: true,
      });

      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
      child.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });

      // Send the prompt as the task text via stdin
      child.stdin.write(prompt);
      child.stdin.end();

      const timer = setTimeout(() => { child.kill(); }, this.timeout);

      child.on("close", (code) => {
        clearTimeout(timer);
        const duration = Date.now() - start;

        if (code !== 0 && !stdout.trim()) {
          resolve({
            verdict: "infra_failure",
            codes: ["companion-error"],
            summary: `codex-companion failed (exit ${code}): ${stderr.slice(0, 300)}`,
            raw: stdout || stderr,
            duration,
          });
          return;
        }

        // Try structured output parsing first
        const pluginVerdict = parsePluginOutput(stdout);
        if (pluginVerdict) {
          resolve(mapPluginVerdict(pluginVerdict, stdout, duration));
          return;
        }

        // Fallback: parse as standard audit response
        resolve(parseAuditResponse(stdout, duration));
      });

      child.on("error", (err) => {
        clearTimeout(timer);
        resolve({
          verdict: "infra_failure",
          codes: ["companion-error"],
          summary: `codex-companion error: ${err.message}`,
          raw: "",
          duration: Date.now() - start,
        });
      });
    });
  }

  async available(): Promise<boolean> {
    return isCodexPluginAvailable();
  }
}
