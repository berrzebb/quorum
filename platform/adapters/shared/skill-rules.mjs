/**
 * Skill Rules Engine — auto-activates skills and domains based on file patterns and prompt keywords.
 *
 * PRD § FR-8: skill-rules.json pattern matching (file extension + path + prompt keyword).
 * Zero LLM cost — pure regex/glob matching.
 *
 * @module adapters/shared/skill-rules
 */

/**
 * @typedef {Object} SkillRule
 * @property {string} pattern - Glob pattern for file matching (e.g. "*.tsx", "src/auth/**")
 * @property {string[]} [keywords] - Prompt keywords that activate this rule
 * @property {string[]} skills - Skills to activate
 * @property {string[]} domains - Domains to activate
 */

/**
 * @typedef {Object} SkillRulesConfig
 * @property {SkillRule[]} rules
 */

/**
 * @typedef {Object} MatchResult
 * @property {string[]} skills - Matched skill names (deduplicated)
 * @property {string[]} domains - Matched domain names (deduplicated)
 */

/**
 * Simple glob matcher — supports *, **, and ? patterns.
 * Good enough for file extension and path matching without external deps.
 *
 * @param {string} pattern
 * @param {string} text
 * @returns {boolean}
 */
function globMatch(pattern, text) {
  // Normalize path separators
  const p = pattern.replace(/\\/g, "/");
  const t = text.replace(/\\/g, "/");

  // Extension-only patterns (e.g. "*.tsx") → match basename anywhere
  if (p.startsWith("*.") && !p.includes("/")) {
    const ext = p.slice(1); // ".tsx"
    return t.endsWith(ext);
  }

  // Convert glob to regex
  const re = p
    .replace(/[.+^${}()|[\]]/g, "\\$&")  // escape regex chars (except * and ?)
    .replace(/\*\*/g, "##DOUBLESTAR##")
    .replace(/\*/g, "[^/]*")
    .replace(/##DOUBLESTAR##/g, ".*")
    .replace(/\?/g, "[^/]");

  return new RegExp(`^${re}$`, "i").test(t);
}

/**
 * Match skills and domains based on file path and/or prompt text.
 *
 * Matching logic (3-way):
 * 1. File pattern: glob match against filePath
 * 2. Keyword: any keyword found in prompt (case-insensitive)
 * 3. Combined: either match activates the rule
 *
 * @param {SkillRule[]} rules - Skill rules array
 * @param {string} [filePath] - File path to match against patterns
 * @param {string} [prompt] - User prompt to match against keywords
 * @returns {MatchResult}
 */
export function matchSkills(rules, filePath, prompt) {
  const skills = new Set();
  const domains = new Set();

  if (!Array.isArray(rules)) return { skills: [], domains: [] };

  const promptLower = (prompt ?? "").toLowerCase();

  for (const rule of rules) {
    let matched = false;

    // 1. File pattern match
    if (filePath && rule.pattern) {
      if (globMatch(rule.pattern, filePath)) matched = true;
    }

    // 2. Keyword match
    if (!matched && promptLower && Array.isArray(rule.keywords)) {
      for (const kw of rule.keywords) {
        if (promptLower.includes(kw.toLowerCase())) {
          matched = true;
          break;
        }
      }
    }

    if (matched) {
      if (Array.isArray(rule.skills)) rule.skills.forEach(s => skills.add(s));
      if (Array.isArray(rule.domains)) rule.domains.forEach(d => domains.add(d));
    }
  }

  return { skills: [...skills], domains: [...domains] };
}

/**
 * Load skill rules from a JSON object (already parsed).
 * Validates structure, returns empty array on invalid input.
 *
 * @param {unknown} data - Parsed JSON content
 * @returns {SkillRule[]}
 */
export function parseSkillRules(data) {
  if (!data || typeof data !== "object") return [];
  const rules = /** @type {SkillRulesConfig} */ (data).rules;
  if (!Array.isArray(rules)) return [];
  return rules.filter(r => r && typeof r.pattern === "string");
}
