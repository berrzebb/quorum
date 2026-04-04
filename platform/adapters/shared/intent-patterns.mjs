/**
 * Intent Pattern Registry — detects gate profile switches from user prompts.
 *
 * Regex-only, zero LLM cost. Korean + English patterns.
 * Called from UserPromptSubmit hook for < 500ms steering.
 *
 * @module adapters/shared/intent-patterns
 */

/** @typedef {"strict" | "balanced" | "fast" | "prototype"} GateProfile */

/**
 * @typedef {Object} IntentPattern
 * @property {GateProfile} profile - Target gate profile
 * @property {RegExp} pattern - Regex to match against user prompt
 * @property {string} label - Human-readable description (for logs)
 */

/** @type {IntentPattern[]} */
const PATTERNS = [
  // ── strict ────────────────────────────────────
  {
    profile: "strict",
    pattern: /빡세게|엄격하?게?|보안\s*중요|꼼꼼하?게?|철저하?게?|security\s*first|strict(?:ly)?|thorough(?:ly)?|careful(?:ly)?|rigor/i,
    label: "strict intent (security/thoroughness)",
  },
  // ── fast ──────────────────────────────────────
  {
    profile: "fast",
    pattern: /빨리|빠르게|간단하?게?|급해|대충|quick(?:ly)?|fast|rapid(?:ly)?|rough|sketchy/i,
    label: "fast intent (speed priority)",
  },
  // ── prototype ─────────────────────────────────
  {
    profile: "prototype",
    pattern: /프로토타입|프로토|MVP|PoC|spike|실험적|실험\s*해\s*보|throwaway|disposable|experiment/i,
    label: "prototype intent (experimental)",
  },
  // ── balanced (explicit reset) ─────────────────
  {
    profile: "balanced",
    pattern: /기본\s*(?:으로|모드)|(?:원래|기본)\s*대로|normal\s*mode|balanced|default\s*mode|reset\s*(?:gate|profile)/i,
    label: "balanced intent (explicit reset)",
  },
];

/**
 * Detect intent from a user prompt string.
 *
 * Evaluates patterns in priority order: strict > fast > prototype > balanced.
 * Returns null when no intent keyword is found (keep current profile).
 *
 * @param {string} prompt - Raw user prompt text
 * @returns {{ profile: GateProfile, label: string, match: string } | null}
 */
export function detectIntent(prompt) {
  if (!prompt || typeof prompt !== "string") return null;
  for (const { profile, pattern, label } of PATTERNS) {
    const m = prompt.match(pattern);
    if (m) return { profile, label, match: m[0] };
  }
  return null;
}

/**
 * Get all registered patterns (for testing/introspection).
 * @returns {ReadonlyArray<IntentPattern>}
 */
export function getPatterns() {
  return PATTERNS;
}
