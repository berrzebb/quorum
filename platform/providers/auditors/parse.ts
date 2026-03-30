/**
 * Shared audit response parser — used by all auditor implementations.
 *
 * Replaces the greedy `\{[\s\S]*\}` regex with balanced-bracket extraction
 * to correctly handle multi-JSON LLM outputs.
 */

import type { AuditResult } from "../provider.js";

/**
 * Extract the first complete JSON object from raw text.
 * Uses balanced-bracket counting (not greedy regex) to avoid
 * capturing extra content between multiple JSON structures.
 */
export function extractJson(raw: string): string | null {
  // 1. Try fenced code block
  const codeBlock = raw.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
  if (codeBlock) return codeBlock[1]!;

  // 2. Balanced bracket extraction
  const start = raw.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < raw.length; i++) {
    const ch = raw[i];
    if (escape) { escape = false; continue; }
    if (ch === "\\") { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") depth++;
    else if (ch === "}") { depth--; if (depth === 0) return raw.slice(start, i + 1); }
  }
  return null;
}

/**
 * Parse an audit response from raw LLM output.
 *
 * @param raw - Raw LLM output text
 * @param duration - Request duration in ms
 * @param skipExtract - If true, parse raw directly as JSON (e.g. response_format: json_object)
 */
export function parseAuditResponse(
  raw: string,
  duration: number,
  skipExtract = false,
): AuditResult {
  try {
    const jsonStr = skipExtract ? raw : extractJson(raw);
    if (!jsonStr) throw new Error("No JSON found");
    const parsed = JSON.parse(jsonStr);
    return {
      verdict: parsed.verdict === "approved"
        ? "approved"
        : parsed.verdict === "infra_failure"
          ? "infra_failure"
          : "changes_requested",
      codes: Array.isArray(parsed.codes) ? parsed.codes : [],
      summary: parsed.summary ?? "",
      raw,
      duration,
    };
  } catch (err) {
    console.warn(`[parse] audit response JSON parse failed: ${(err as Error).message}`);
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
