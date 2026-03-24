/**
 * Gemini Auditor — runs audits via Google Gemini API (direct HTTP).
 *
 * Calls the Gemini generateContent API directly.
 */

import type { Auditor, AuditRequest, AuditResult } from "../provider.js";
import { parseAuditResponse } from "./parse.js";

export interface GeminiAuditorConfig {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  timeout?: number;
}

export class GeminiAuditor implements Auditor {
  private apiKey: string;
  private model: string;
  private baseUrl: string;
  private timeout: number;

  constructor(config: GeminiAuditorConfig = {}) {
    this.apiKey = config.apiKey ?? process.env.GEMINI_API_KEY ?? "";
    this.model = config.model ?? "gemini-2.5-flash";
    this.baseUrl = config.baseUrl ?? "https://generativelanguage.googleapis.com/v1beta";
    this.timeout = config.timeout ?? 120_000;
  }

  async audit(request: AuditRequest): Promise<AuditResult> {
    const start = Date.now();

    if (!this.apiKey) {
      return {
        verdict: "infra_failure",
        codes: ["auditor-error"],
        summary: "GEMINI_API_KEY not set",
        raw: "",
        duration: Date.now() - start,
      };
    }

    const prompt = formatPrompt(request);

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeout);

      const url = `${this.baseUrl}/models/${this.model}:generateContent?key=${this.apiKey}`;
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.2, responseMimeType: "application/json" },
        }),
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!response.ok) {
        const err = await response.text();
        return {
          verdict: "infra_failure",
          codes: ["auditor-error"],
          summary: `Gemini API ${response.status}: ${err.slice(0, 200)}`,
          raw: err,
          duration: Date.now() - start,
        };
      }

      const data = await response.json() as { candidates: { content: { parts: { text: string }[] } }[] };
      const raw = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
      return parseAuditResponse(raw, Date.now() - start);
    } catch (err) {
      return {
        verdict: "infra_failure",
        codes: ["auditor-error"],
        summary: `Gemini API error: ${(err as Error).message}`,
        raw: "",
        duration: Date.now() - start,
      };
    }
  }

  async available(): Promise<boolean> {
    return !!this.apiKey;
  }
}

function formatPrompt(request: AuditRequest): string {
  return `You are a code auditor.\n\n${request.prompt}\n\n## Evidence\n\n${request.evidence}\n\n## Changed Files\n\n${request.files.map((f) => `- ${f}`).join("\n")}\n\nRespond with JSON only:\n{"verdict": "approved" | "changes_requested" | "infra_failure", "codes": [], "summary": "..."}`;
}

