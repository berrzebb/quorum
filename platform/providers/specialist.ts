/**
 * Specialist Review Orchestrator — enriches audit evidence with domain-specific findings.
 *
 * Sits between domain detection and the core consensus protocol.
 * Runs deterministic tools and optional LLM specialist agents,
 * then injects their findings into the evidence before passing
 * to the standard 3-role consensus (advocate/devil/judge).
 *
 * The core consensus.ts is NOT modified — specialist findings
 * become part of the evidence the judge sees.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { DOMAIN_NAMES } from "./domain-detect.js";
import type { ReviewerSelection } from "./domain-router.js";
import type { Finding, FindingSeverity } from "../bus/events.js";

const execFileAsync = promisify(execFile);

// ── Types ────────────────────────────────────

export interface ToolResult {
  tool: string;
  domain: string;
  status: "pass" | "fail" | "warn" | "error" | "skip";
  output: string;
  duration: number;
}

export interface SpecialistOpinion {
  agent: string;
  domain: string;
  verdict: "approved" | "changes_requested";
  reasoning: string;
  codes: string[];
  findings: SpecialistFinding[];
  confidence: number;
}

export interface SpecialistFinding {
  file: string;
  line?: number;
  severity: "critical" | "high" | "medium" | "low";
  issue: string;
  suggestion?: string;
}

export interface SpecialistReviewResult {
  toolResults: ToolResult[];
  opinions: SpecialistOpinion[];
  enrichedEvidence: string;
  /** Quick pre-check: if any tool hard-fails, can short-circuit. */
  hasBlockingToolFailure: boolean;
  /** All rejection codes from specialist reviews. */
  codes: string[];
  duration: number;
}

// ── Tool execution ───────────────────────────

/**
 * Run a deterministic MCP tool and capture its result.
 * Tools are executed via the tool-runner CLI for isolation.
 */
export async function runSpecialistTool(
  tool: string,
  domain: string,
  cwd: string,
): Promise<ToolResult> {
  const start = Date.now();
  try {
    const toolRunner = new URL("../core/tools/tool-runner.mjs", import.meta.url).pathname;
    const { stdout } = await execFileAsync("node", [toolRunner, tool, "--json"], {
      cwd,
      timeout: 30_000,
      env: { ...process.env, QUORUM_TOOL_MODE: "specialist" },
    });

    const hasFailure = /\bfail\b|violation|error/i.test(stdout);
    return {
      tool,
      domain,
      status: hasFailure ? "fail" : "pass",
      output: stdout.slice(0, 4000), // cap output for evidence injection
      duration: Date.now() - start,
    };
  } catch (err) {
    return {
      tool,
      domain,
      status: "error",
      output: err instanceof Error ? err.message : String(err),
      duration: Date.now() - start,
    };
  }
}

// ── ToolResult → Finding conversion ──────────

const SEVERITY_MAP: Record<string, FindingSeverity> = {
  critical: "critical", high: "critical",
  medium: "major", major: "major",
  low: "minor", minor: "minor",
  style: "style", info: "style",
};

/**
 * Parse a ToolResult's JSON output into structured Finding objects.
 * Tool JSON shape: { findings: [{ file, line, severity, label, msg }, ...] }
 */
export function parseToolFindings(
  toolResult: ToolResult,
): Array<Omit<Finding, "id" | "status">> {
  try {
    const parsed = JSON.parse(toolResult.output);
    const rawFindings = parsed?.findings ?? parsed?.json?.findings;
    if (!Array.isArray(rawFindings)) return [];

    return rawFindings.map((f: Record<string, unknown>) => ({
      reviewerId: `specialist-${toolResult.tool}`,
      provider: toolResult.domain,
      severity: SEVERITY_MAP[String(f.severity ?? "minor").toLowerCase()] ?? "minor",
      category: String(f.label ?? f.category ?? toolResult.domain),
      description: String(f.msg ?? f.description ?? f.issue ?? ""),
      file: f.file ? String(f.file) : undefined,
      line: typeof f.line === "number" ? f.line : undefined,
      suggestion: f.suggestion ? String(f.suggestion) : undefined,
    }));
  } catch (err) {
    console.warn(`[specialist] parseToolFindings JSON parse failed: ${(err as Error).message}`);
    return [];
  }
}

// ── Evidence enrichment ──────────────────────

/**
 * Format tool results and specialist opinions into markdown
 * that gets appended to the audit evidence.
 */
export function buildSpecialistSection(
  toolResults: ToolResult[],
  opinions: SpecialistOpinion[],
): string {
  const sections: string[] = ["## Specialist Reviews"];

  // Tool results
  if (toolResults.length > 0) {
    sections.push("");
    sections.push("### Deterministic Tool Results");
    for (const result of toolResults) {
      const icon = result.status === "pass" ? "\u2705" : result.status === "fail" ? "\u274C" : "\u26A0\uFE0F";
      sections.push(`\n**${icon} ${result.tool}** (${result.domain}, ${result.duration}ms)`);
      if (result.output && result.status !== "pass") {
        // Only include output for non-passing results to keep evidence concise
        sections.push("```");
        sections.push(result.output.slice(0, 2000));
        sections.push("```");
      }
    }
  }

  // Specialist opinions
  if (opinions.length > 0) {
    sections.push("");
    sections.push("### Specialist Agent Opinions");
    for (const opinion of opinions) {
      const icon = opinion.verdict === "approved" ? "\u2705" : "\u274C";
      sections.push(`\n**${icon} ${opinion.agent}** (${opinion.domain}, confidence: ${opinion.confidence})`);
      sections.push(`Verdict: ${opinion.verdict}`);
      if (opinion.codes.length > 0) {
        sections.push(`Codes: ${opinion.codes.join(", ")}`);
      }
      sections.push(`Reasoning: ${opinion.reasoning}`);
      if (opinion.findings.length > 0) {
        sections.push("\nFindings:");
        for (const f of opinion.findings.slice(0, 10)) {
          sections.push(`- **${f.severity}** ${f.file}${f.line ? `:${f.line}` : ""} — ${f.issue}`);
        }
      }
    }
  }

  return sections.join("\n");
}

/**
 * Enrich audit evidence with specialist findings.
 * The enriched evidence is passed to the existing consensus protocol.
 */
export function enrichEvidence(
  originalEvidence: string,
  toolResults: ToolResult[],
  opinions: SpecialistOpinion[],
): string {
  if (toolResults.length === 0 && opinions.length === 0) {
    return originalEvidence;
  }
  const specialistSection = buildSpecialistSection(toolResults, opinions);
  return `${originalEvidence}\n\n${specialistSection}`;
}

// ── Dynamic Specialist Spawn ─────────────────

export interface SpawnCandidate {
  domain: string;
  reason: string;
  trigger: "finding";
  parentReviewerId?: string;
}

/**
 * Detect domains mentioned in findings that aren't covered by active specialists.
 * Returns candidates for dynamic specialist spawn mid-review.
 *
 * Heuristic: scan finding descriptions + categories for domain keywords,
 * compare against already-active domains.
 */
export function detectMissingSpecialists(
  findings: Array<{ category: string; description: string; file?: string; reviewerId: string }>,
  activeDomains: Set<string>,
): SpawnCandidate[] {
  const candidates = new Map<string, SpawnCandidate>();

  for (const f of findings) {
    const text = `${f.category} ${f.description} ${f.file ?? ""}`.toLowerCase();
    for (const [domain, keywords] of DOMAIN_KEYWORDS) {
      if (activeDomains.has(domain)) continue;
      if (candidates.has(domain)) continue;
      if (keywords.some(kw => text.includes(kw))) {
        candidates.set(domain, {
          domain,
          reason: `finding mentions "${domain}" keywords in "${f.category}"`,
          trigger: "finding",
          parentReviewerId: f.reviewerId,
        });
      }
    }
  }

  return [...candidates.values()];
}

/**
 * Keywords for detecting specialist domains from finding text.
 * Domain names are validated against domain-detect.ts canonical list at import time
 * to prevent drift when new domains are added.
 */
const DOMAIN_KEYWORDS = new Map<string, string[]>([
  ["performance", ["n+1", "slow query", "latency", "cache miss", "bundle size", "memory leak"]],
  ["migration", ["breaking change", "schema change", "migration", "backward compat"]],
  ["accessibility", ["aria", "screen reader", "keyboard nav", "wcag", "focus trap"]],
  ["compliance", ["pii", "gdpr", "license", "credential", "secret", "token exposure"]],
  ["observability", ["logging", "no error handling", "unhandled", "silent fail", "no metrics"]],
  ["concurrency", ["race condition", "deadlock", "shared state", "mutex", "atomic"]],
  ["i18n", ["hardcoded string", "locale", "translation", "i18n"]],
  ["infrastructure", ["dockerfile", "env var", "ci/cd", "deploy", "container"]],
]);

// Drift guard: verify all canonical domains have keyword entries.
// Logs a warning at startup if domain-detect adds a domain without keywords here.
for (const domain of DOMAIN_NAMES) {
  if (!DOMAIN_KEYWORDS.has(domain)) {
    if (typeof process !== "undefined" && process.env?.QUORUM_DEBUG) {
      console.warn(`[specialist] Missing DOMAIN_KEYWORDS entry for domain: ${domain}`);
    }
  }
}

// ── Orchestrator ─────────────────────────────

/**
 * Run the full specialist review pipeline.
 *
 * 1. Execute deterministic tools (parallel, zero cost)
 * 2. Run LLM specialist agents (parallel, conditional on tier)
 * 3. Build enriched evidence with findings
 *
 * @param selection - Output from selectReviewers()
 * @param evidence - Original audit evidence markdown
 * @param cwd - Working directory for tool execution
 * @param runAgent - Callback to invoke an LLM agent (injected to avoid circular deps)
 */
export async function runSpecialistReviews(
  selection: ReviewerSelection,
  evidence: string,
  cwd: string,
  runAgent?: (agentName: string, evidence: string, domain: string) => Promise<SpecialistOpinion>,
): Promise<SpecialistReviewResult> {
  const start = Date.now();

  // 1. Run deterministic tools (parallel)
  const toolPromises = selection.tools.map(tool => {
    const reviewer = selection.reviewers.find(r => r.tool === tool);
    return runSpecialistTool(tool, reviewer?.domain ?? "unknown", cwd);
  });

  // 2. Run LLM agents (parallel, if callback provided)
  const agentPromises: Promise<SpecialistOpinion>[] = [];
  if (runAgent) {
    for (const agentName of selection.agents) {
      const reviewer = selection.reviewers.find(r => r.agent === agentName);
      if (reviewer) {
        agentPromises.push(
          runAgent(agentName, evidence, reviewer.domain).catch(err => ({
            agent: agentName,
            domain: reviewer.domain,
            verdict: "changes_requested" as const,
            reasoning: `Agent failed: ${err instanceof Error ? err.message : String(err)}`,
            codes: ["infra-failure"],
            findings: [],
            confidence: 0,
          })),
        );
      }
    }
  }

  // Await all in parallel
  const [toolResults, ...opinions] = await Promise.all([
    Promise.all(toolPromises),
    ...agentPromises,
  ]) as [ToolResult[], ...SpecialistOpinion[]];

  const hasBlockingToolFailure = toolResults.some(r => r.status === "fail");
  const allCodes = [
    ...toolResults.filter(r => r.status === "fail").flatMap(r => [`${r.domain}-tool-fail`]),
    ...opinions.flatMap(o => o.codes),
  ];

  return {
    toolResults,
    opinions,
    enrichedEvidence: enrichEvidence(evidence, toolResults, opinions),
    hasBlockingToolFailure,
    codes: [...new Set(allCodes)],
    duration: Date.now() - start,
  };
}
