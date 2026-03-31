/**
 * Codex Plugin Bridge — maps between quorum and codex-plugin-cc formats.
 *
 * Converts quorum's AuditRequest into a prompt suitable for codex-plugin-cc's
 * `codex-companion.mjs task` command, and maps the structured output back
 * to quorum's AuditResult.
 *
 * Uses GPT-5.4 prompting patterns (XML-tag structure) from codex-plugin-cc's
 * gpt-5-4-prompting skill for optimal Codex results.
 */

import type { AuditRequest, AuditResult } from "../provider.js";

// ── Request Mapping ─────────────────────────────────────

/**
 * Convert a quorum AuditRequest into a codex-plugin-cc task prompt.
 *
 * Uses XML-tag structure from codex-plugin-cc's GPT-5.4 prompting patterns:
 * <task>, <grounding_rules>, <structured_output_contract>
 */
export function buildCompanionPrompt(request: AuditRequest): string {
  const fileList = request.files.map(f => `- ${f}`).join("\n");

  return `<task>
You are a code auditor. Review the following evidence and changed files.
Determine whether the changes should be approved or require further work.

${request.prompt}
</task>

<evidence>
${request.evidence}
</evidence>

<changed_files>
${fileList}
</changed_files>

<grounding_rules>
- Only judge based on the evidence provided above.
- Do not make assumptions about code you have not seen.
- Anchor all findings to specific files and line numbers when possible.
- If evidence is insufficient, state what is missing rather than guessing.
</grounding_rules>

<structured_output_contract>
Respond with ONLY a JSON object matching this schema:
{
  "verdict": "approve" | "needs-attention",
  "summary": "brief analysis summary",
  "findings": [
    {
      "severity": "high" | "medium" | "low",
      "title": "finding title",
      "body": "detailed explanation",
      "file": "path/to/file",
      "line_start": 0,
      "confidence": 0.95,
      "recommendation": "what to fix"
    }
  ],
  "rejection_codes": ["code-if-any"],
  "next_steps": ["recommended action"]
}
</structured_output_contract>`;
}

// ── Response Mapping ────────────────────────────────────

/** Shape of codex-plugin-cc structured output for audit verdicts. */
export interface CodexPluginVerdict {
  verdict: "approve" | "needs-attention";
  summary?: string;
  findings?: Array<{
    severity?: string;
    title?: string;
    body?: string;
    file?: string;
    line_start?: number;
    confidence?: number;
    recommendation?: string;
  }>;
  rejection_codes?: string[];
  next_steps?: string[];
}

/**
 * Map codex-plugin-cc structured output to quorum AuditResult.
 */
export function mapPluginVerdict(
  output: CodexPluginVerdict,
  raw: string,
  duration: number,
): AuditResult {
  const passed = output.verdict === "approve";

  // Extract rejection codes from findings if not explicitly provided
  const codes = output.rejection_codes?.length
    ? output.rejection_codes
    : (output.findings ?? [])
        .filter(f => f.severity === "high" || f.severity === "medium")
        .map(f => f.title?.toLowerCase().replace(/\s+/g, "-") ?? "finding")
        .slice(0, 10);

  // Build summary from findings if summary is missing
  const findingSummary = (output.findings ?? []).map(f => `[${f.severity}] ${f.title}`).join("; ");
  const summary = output.summary
    ?? (findingSummary || (passed ? "All checks passed" : "Issues found"));

  return {
    verdict: passed ? "approved" : "changes_requested",
    codes: passed ? [] : codes,
    summary,
    raw,
    duration,
  };
}

/**
 * Parse raw codex-plugin-cc output into a CodexPluginVerdict.
 *
 * Handles multiple output formats:
 * 1. Direct JSON (structured output mode)
 * 2. JSON embedded in markdown/text
 * 3. NDJSON with final message containing verdict
 */
export function parsePluginOutput(raw: string): CodexPluginVerdict | null {
  // 1. Try direct JSON parse
  try {
    const parsed = JSON.parse(raw.trim());
    if (parsed.verdict) return parsed as CodexPluginVerdict;
  } catch { /* not direct JSON */ }

  // 2. Try extracting from fenced code block
  const fenced = raw.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
  if (fenced) {
    try {
      const parsed = JSON.parse(fenced[1]!);
      if (parsed.verdict) return parsed as CodexPluginVerdict;
    } catch { /* invalid JSON in fence */ }
  }

  // 3. Try balanced brace extraction (find first complete JSON with "verdict")
  const verdictIdx = raw.indexOf('"verdict"');
  if (verdictIdx >= 0) {
    let start = raw.lastIndexOf("{", verdictIdx);
    if (start >= 0) {
      const extracted = extractBalancedJson(raw, start);
      if (extracted) {
        try {
          const parsed = JSON.parse(extracted);
          if (parsed.verdict) return parsed as CodexPluginVerdict;
        } catch { /* invalid JSON */ }
      }
    }
  }

  // 4. Try NDJSON — look for the last line with a verdict
  const lines = raw.split("\n").reverse();
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      const parsed = JSON.parse(trimmed);
      // Direct verdict
      if (parsed.verdict) return parsed as CodexPluginVerdict;
      // Codex wrapper: { type: "...", content: "...{verdict...}" }
      const inner = parsed.content ?? parsed.text ?? parsed.result ?? parsed.message;
      if (typeof inner === "string" && inner.includes('"verdict"')) {
        const nested = parsePluginOutput(inner);
        if (nested) return nested;
      }
    } catch { /* not JSON */ }
  }

  return null;
}

/** Extract a balanced JSON object starting at `start` index. */
function extractBalancedJson(s: string, start: number): string | null {
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < s.length && i < start + 10_000; i++) {
    const ch = s[i];
    if (escape) { escape = false; continue; }
    if (ch === "\\") { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}
