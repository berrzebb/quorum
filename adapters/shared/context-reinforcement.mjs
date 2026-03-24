/**
 * Shared context reinforcement — re-injects core protocol rules into session context.
 *
 * Extracted from session-start.mjs L274-303.
 * Reads "Absolute Rules" section from AI-GUIDE.md (Policy as Data).
 * Returns the reinforcement text — caller decides how to embed it.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Find AI-GUIDE.md path with locale fallback.
 *
 * @param {string} adapterRoot — adapter root directory (contains docs/{locale}/)
 * @param {string} [locale="en"] — preferred locale
 * @returns {string|null} Absolute path to AI-GUIDE.md or null
 */
export function findGuidePath(adapterRoot, locale = "en") {
  const primary = resolve(adapterRoot, "docs", locale, "AI-GUIDE.md");
  if (existsSync(primary)) return primary;

  // Fallback: try the other locale
  const fallback = locale === "ko" ? "en" : "ko";
  const secondary = resolve(adapterRoot, "docs", fallback, "AI-GUIDE.md");
  if (existsSync(secondary)) return secondary;

  return null;
}

/**
 * Build context reinforcement text from AI-GUIDE.md.
 *
 * @param {object} params
 * @param {string} params.adapterRoot — adapter root directory
 * @param {string} [params.locale="en"] — preferred locale
 * @param {string} [params.agreeTag="[APPROVED]"] — agree tag for self-promotion warning
 * @returns {string|null} Reinforcement text wrapped in XML tags, or null if guide not found
 */
export function buildContextReinforcement({ adapterRoot, locale = "en", agreeTag = "[APPROVED]" }) {
  const guidePath = findGuidePath(adapterRoot, locale);
  if (!guidePath) return null;

  try {
    const guideContent = readFileSync(guidePath, "utf8");
    const sectionMatch = guideContent.match(
      /^(## (?:절대 규칙|Absolute Rules)\s*\n(?:(?!^## ).+\n)*)/m
    );
    if (!sectionMatch) return null;

    const rules = sectionMatch[1].trim();
    const lines = [
      `<CONTEXT-REINFORCEMENT>`,
      rules,
      ``,
      `Run /quorum:verify before evidence submission. Self-promotion (${agreeTag}) is strictly forbidden.`,
      `</CONTEXT-REINFORCEMENT>`,
    ];
    return lines.join("\n");
  } catch {
    return null;
  }
}
