/**
 * Structured Output Schemas — JSON Schema definitions for audit verdicts.
 *
 * Used by codex-plugin-cc's structured output validation and by quorum's
 * consensus engine for schema-first parsing (skipping extractJson fallback).
 *
 * Three schema variants:
 * - Advocate opinion (approval-leaning, focus on strengths)
 * - Devil opinion (rejection-leaning, focus on weaknesses)
 * - Judge verdict (final decision with summary)
 */

// ── Types ───────────────────────────────────────────────

/** Structured advocate/devil opinion (matches RoleOpinion fields). */
export interface StructuredOpinion {
  verdict: "approved" | "changes_requested";
  reasoning: string;
  codes: string[];
  confidence: number;
  findings?: StructuredFinding[];
}

/** Structured judge verdict. */
export interface StructuredJudgeVerdict {
  verdict: "approved" | "changes_requested";
  summary: string;
  codes: string[];
  findings?: StructuredFinding[];
}

/** Individual finding with severity and location. */
export interface StructuredFinding {
  severity: "high" | "medium" | "low";
  title: string;
  body: string;
  file?: string;
  line_start?: number;
  confidence?: number;
}

// ── Schema Definitions ──────────────────────────────────

/** JSON Schema for advocate/devil role opinions. */
export const OPINION_SCHEMA = {
  type: "object" as const,
  properties: {
    verdict: { type: "string" as const, enum: ["approved", "changes_requested"] },
    reasoning: { type: "string" as const },
    codes: { type: "array" as const, items: { type: "string" as const } },
    confidence: { type: "number" as const, minimum: 0, maximum: 1 },
    findings: {
      type: "array" as const,
      items: {
        type: "object" as const,
        properties: {
          severity: { type: "string" as const, enum: ["high", "medium", "low"] },
          title: { type: "string" as const },
          body: { type: "string" as const },
          file: { type: "string" as const },
          line_start: { type: "number" as const },
          confidence: { type: "number" as const },
        },
        required: ["severity", "title", "body"],
      },
    },
  },
  required: ["verdict", "reasoning", "codes", "confidence"],
} as const;
Object.freeze(OPINION_SCHEMA);

/** JSON Schema for judge final verdict. */
export const JUDGE_VERDICT_SCHEMA = {
  type: "object" as const,
  properties: {
    verdict: { type: "string" as const, enum: ["approved", "changes_requested"] },
    summary: { type: "string" as const },
    codes: { type: "array" as const, items: { type: "string" as const } },
    findings: {
      type: "array" as const,
      items: {
        type: "object" as const,
        properties: {
          severity: { type: "string" as const, enum: ["high", "medium", "low"] },
          title: { type: "string" as const },
          body: { type: "string" as const },
          file: { type: "string" as const },
          line_start: { type: "number" as const },
          confidence: { type: "number" as const },
        },
        required: ["severity", "title", "body"],
      },
    },
  },
  required: ["verdict", "summary", "codes"],
} as const;
Object.freeze(JUDGE_VERDICT_SCHEMA);

// ── Validation ──────────────────────────────────────────

/**
 * Validate and parse a structured opinion from raw output.
 * Returns null if the output doesn't match the expected schema.
 *
 * This is the "fast path" — when structured output is available,
 * we skip extractJson/regex parsing entirely.
 */
export function parseStructuredOpinion(raw: string): StructuredOpinion | null {
  try {
    const parsed = JSON.parse(raw.trim());
    if (!isValidOpinion(parsed)) return null;
    return {
      verdict: parsed.verdict,
      reasoning: parsed.reasoning ?? "",
      codes: Array.isArray(parsed.codes) ? parsed.codes : [],
      confidence: typeof parsed.confidence === "number" ? clamp(parsed.confidence) : 0.5,
      findings: Array.isArray(parsed.findings) ? parsed.findings : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Validate and parse a structured judge verdict from raw output.
 */
export function parseStructuredJudgeVerdict(raw: string): StructuredJudgeVerdict | null {
  try {
    const parsed = JSON.parse(raw.trim());
    if (!isValidJudgeVerdict(parsed)) return null;
    return {
      verdict: parsed.verdict,
      summary: parsed.summary ?? "",
      codes: Array.isArray(parsed.codes) ? parsed.codes : [],
      findings: Array.isArray(parsed.findings) ? parsed.findings : undefined,
    };
  } catch {
    return null;
  }
}

// ── Helpers ─────────────────────────────────────────────

function isValidOpinion(obj: unknown): obj is StructuredOpinion {
  if (!obj || typeof obj !== "object") return false;
  const o = obj as Record<string, unknown>;
  return (o.verdict === "approved" || o.verdict === "changes_requested")
    && typeof o.reasoning === "string"
    && typeof o.confidence === "number"
    && (Array.isArray(o.codes) || o.codes === undefined);
}

function isValidJudgeVerdict(obj: unknown): obj is StructuredJudgeVerdict {
  if (!obj || typeof obj !== "object") return false;
  const o = obj as Record<string, unknown>;
  return (o.verdict === "approved" || o.verdict === "changes_requested")
    && typeof o.summary === "string";
}

function clamp(n: number): number {
  return Math.max(0, Math.min(1, n));
}
