/**
 * Adversarial Review — wraps codex-plugin-cc's adversarial-review command
 * as a quorum specialist review.
 *
 * Uses codex-plugin-cc's `/codex:adversarial-review` functionality to
 * challenge implementation decisions, design choices, tradeoffs, and
 * hidden assumptions. Integrates into quorum's consensus protocol as
 * a supplementary 4th opinion when confidence delta is narrow.
 *
 * SDK-15: Enriches findings with capability metadata from the tool registry.
 * When a finding references a tool, the capability annotation (isDestructive,
 * isReadOnly, etc.) is attached to help downstream consumers prioritize.
 */

import { spawn } from "node:child_process";
import { isCodexPluginAvailable, getCompanionScriptPath } from "./broker-detect.js";
import { parsePluginOutput } from "./plugin-bridge.js";
import type { AuditResult } from "../provider.js";
import { getCapability } from "../../core/tools/capability-registry.js";
import type { ToolCapabilityAnnotation } from "../event-mapper.js";

export interface AdversarialReviewRequest {
  /** Focus areas for the adversarial review (e.g. "race conditions", "auth design"). */
  focus?: string;
  /** Git base ref for branch comparison (default: "HEAD~1"). */
  baseRef?: string;
  /** Working directory. */
  cwd?: string;
  /** Timeout in ms (default: 300000 — adversarial reviews take longer). */
  timeout?: number;
}

export interface AdversarialFinding {
  severity: "high" | "medium" | "low";
  title: string;
  body: string;
  file?: string;
  lineStart?: number;
  confidence: number;
  recommendation?: string;
  /** Tool capability annotation — present when finding references a known tool. @since SDK-15 */
  toolCapability?: ToolCapabilityAnnotation;
}

export interface AdversarialReviewResult {
  /** Whether the review found significant issues. */
  hasIssues: boolean;
  /** Summary of the adversarial review. */
  summary: string;
  /** Detailed findings. */
  findings: AdversarialFinding[];
  /** Suggested next steps. */
  nextSteps: string[];
  /** Raw output from codex-plugin-cc. */
  raw: string;
  /** Duration in ms. */
  duration: number;
}

/**
 * Check if adversarial review is available (requires codex-plugin-cc).
 */
export function isAdversarialReviewAvailable(): boolean {
  return isCodexPluginAvailable();
}

/**
 * Run an adversarial review using codex-plugin-cc.
 *
 * This challenges the implementation by questioning design decisions,
 * tradeoffs, failure modes, and whether different approaches would be
 * safer or simpler.
 */
export async function runAdversarialReview(
  request: AdversarialReviewRequest = {},
): Promise<AdversarialReviewResult> {
  const start = Date.now();
  const companionPath = getCompanionScriptPath();

  if (!companionPath) {
    return {
      hasIssues: false,
      summary: "codex-plugin-cc not available — adversarial review skipped",
      findings: [],
      nextSteps: [],
      raw: "",
      duration: Date.now() - start,
    };
  }

  const args = [companionPath, "adversarial-review"];
  if (request.baseRef) {
    args.push("--base", request.baseRef);
  }
  args.push("--wait"); // Synchronous execution
  if (request.focus) {
    args.push(request.focus);
  }

  const timeout = request.timeout ?? 300_000;
  const cwd = request.cwd ?? process.cwd();

  return new Promise<AdversarialReviewResult>((resolve) => {
    const child = spawn(process.execPath, args, {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
    child.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
    child.stdin.end();

    const timer = setTimeout(() => { child.kill(); }, timeout);

    child.on("close", (code) => {
      clearTimeout(timer);
      const duration = Date.now() - start;

      if (code !== 0 && !stdout.trim()) {
        resolve({
          hasIssues: false,
          summary: `Adversarial review failed (exit ${code}): ${stderr.slice(0, 200)}`,
          findings: [],
          nextSteps: [],
          raw: stdout || stderr,
          duration,
        });
        return;
      }

      // Parse structured output
      const verdict = parsePluginOutput(stdout);
      if (verdict) {
        resolve({
          hasIssues: verdict.verdict === "needs-attention",
          summary: verdict.summary ?? "Review complete",
          findings: (verdict.findings ?? []).map(f => {
            const finding: AdversarialFinding = {
              severity: (f.severity as "high" | "medium" | "low") ?? "medium",
              title: f.title ?? "Finding",
              body: f.body ?? "",
              file: f.file,
              lineStart: f.line_start,
              confidence: f.confidence ?? 0.5,
              recommendation: f.recommendation,
            };
            // SDK-15: Enrich with tool capability if finding references a known tool
            const toolName = (f as Record<string, unknown>).tool_name as string | undefined;
            if (toolName) {
              const cap = getCapability(toolName);
              if (cap) {
                finding.toolCapability = {
                  isDestructive: cap.isDestructive,
                  isReadOnly: cap.isReadOnly,
                  isConcurrencySafe: cap.isConcurrencySafe,
                  category: cap.category,
                };
              }
            }
            return finding;
          }),
          nextSteps: verdict.next_steps ?? [],
          raw: stdout,
          duration,
        });
        return;
      }

      // Fallback: treat as text output
      resolve({
        hasIssues: stdout.toLowerCase().includes("needs-attention") || stdout.toLowerCase().includes("block"),
        summary: stdout.slice(0, 500),
        findings: [],
        nextSteps: [],
        raw: stdout,
        duration,
      });
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({
        hasIssues: false,
        summary: `Adversarial review error: ${err.message}`,
        findings: [],
        nextSteps: [],
        raw: "",
        duration: Date.now() - start,
      });
    });
  });
}

/**
 * Convert an AdversarialReviewResult into a quorum AuditResult.
 * Used when integrating as a 4th consensus opinion.
 */
export function toAuditResult(review: AdversarialReviewResult): AuditResult {
  return {
    verdict: review.hasIssues ? "changes_requested" : "approved",
    codes: review.findings
      .filter(f => f.severity === "high")
      .map(f => f.title.toLowerCase().replace(/\s+/g, "-"))
      .slice(0, 10),
    summary: review.summary,
    raw: review.raw,
    duration: review.duration,
  };
}
