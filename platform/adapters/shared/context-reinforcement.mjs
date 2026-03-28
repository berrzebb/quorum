/**
 * Shared context reinforcement — re-injects core protocol rules into session context.
 *
 * Reads "Absolute Rules" section from AGENTS.md (Policy as Data).
 * Returns the reinforcement text — caller decides how to embed it.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Find AGENTS.md path with locale fallback.
 *
 * New locale convention: docs/ (EN root), docs/ko-KR/ (Korean)
 *
 * @param {string} adapterRoot — adapter root directory (contains docs/)
 * @param {string} [locale="en"] — preferred locale
 * @returns {string|null} Absolute path to AGENTS.md or null
 */
export function findGuidePath(adapterRoot, locale = "en") {
  // New convention: docs/ko-KR/ for Korean, docs/ for English (root)
  const localeDir = locale === "ko" ? "ko-KR" : "";
  const primary = resolve(adapterRoot, "docs", localeDir, "AGENTS.md");
  if (existsSync(primary)) return primary;

  // Fallback: English root
  const fallback = resolve(adapterRoot, "docs", "AGENTS.md");
  if (existsSync(fallback)) return fallback;

  return null;
}

/**
 * Build context reinforcement text from AGENTS.md.
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
