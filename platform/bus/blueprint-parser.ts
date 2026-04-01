/**
 * Blueprint Parser — extracts naming conventions from Design Phase Blueprint markdown.
 *
 * Parses the "Naming Conventions" table from Blueprint documents:
 * | Concept | Name | Rationale |
 * |---------|------|-----------|
 * | Restaurant list | Restaurants | Plural noun |
 *
 * Each row becomes a NamingRule that the blueprint_lint tool enforces.
 * Names are "law" — any identifier in source code that matches the Concept
 * but uses a different Name is a violation.
 */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve, extname } from "node:path";

// Optional vendor: marked for structured markdown parsing (fail-safe)
let _marked: { lexer: (md: string) => any[] } | null = null;
try {
  _marked = await import("marked") as any;
} catch { /* fallback to regex parsing */ }

// ── Types ────────────────────────────────────

export interface NamingRule {
  /** What the concept represents (e.g., "Restaurant list"). */
  concept: string;
  /** The mandated identifier name (e.g., "Restaurants"). */
  name: string;
  /** Why this name was chosen. */
  rationale: string;
  /** Source Blueprint file path. */
  source: string;
  /** Regex pattern to detect violations (wrong names for this concept). */
  violationPattern: RegExp;
  /** Alternative names that would be violations. */
  alternatives: string[];
}

export interface BlueprintRules {
  rules: NamingRule[];
  /** Blueprint files that were parsed. */
  sources: string[];
}

// ── Parser ───────────────────────────────────

/**
 * Parse all Blueprint files in a design directory for naming conventions.
 */
export function parseBlueprints(designDir: string): BlueprintRules {
  const rules: NamingRule[] = [];
  const sources: string[] = [];

  if (!existsSync(designDir)) return { rules, sources };

  // Find all markdown files in design directory
  const files = findMarkdownFiles(designDir);

  for (const file of files) {
    const content = readFileSync(file, "utf8");
    const fileRules = extractNamingRules(content, file);
    rules.push(...fileRules);
    if (fileRules.length > 0) sources.push(file);
  }

  return { rules, sources };
}

/**
 * Parse a single Blueprint markdown string for naming convention tables.
 * Uses `marked` lexer when available for robust table parsing,
 * falls back to regex for environments without the vendor package.
 */
export function extractNamingRules(content: string, source: string = "blueprint.md"): NamingRule[] {
  // Try structured parsing first (marked), fallback to regex
  if (_marked) {
    const result = extractNamingRulesWithMarked(content, source);
    if (result.length > 0) return result;
  }
  return extractNamingRulesRegex(content, source);
}

/** Structured parsing via marked lexer — finds tables under "Naming Conventions" headings. */
function extractNamingRulesWithMarked(content: string, source: string): NamingRule[] {
  const rules: NamingRule[] = [];
  const tokens = _marked!.lexer(content);

  let inNamingSection = false;
  for (const token of tokens) {
    // Track when we enter/leave a Naming Conventions heading
    if (token.type === "heading") {
      inNamingSection = /naming\s+convention/i.test(token.text);
      continue;
    }

    // Parse tables inside Naming Conventions sections
    if (inNamingSection && token.type === "table") {
      const headers = (token.header || []).map((h: any) => (h.text || "").toLowerCase());
      const conceptIdx = headers.findIndex((h: string) => h.includes("concept"));
      const nameIdx = headers.findIndex((h: string) => h === "name" || h.includes("name"));
      const rationaleIdx = headers.findIndex((h: string) => h.includes("rationale") || h.includes("reason"));

      if (conceptIdx === -1 || nameIdx === -1) continue;

      for (const row of token.rows || []) {
        const concept = (row[conceptIdx]?.text || "").replace(/`/g, "").trim();
        const name = (row[nameIdx]?.text || "").replace(/`/g, "").trim();
        const rationale = rationaleIdx >= 0 ? (row[rationaleIdx]?.text || "").trim() : "";

        if (!concept || !name) continue;

        const alternatives = generateAlternatives(concept, name);
        const violationPattern = buildViolationPattern(name, alternatives);
        rules.push({ concept, name, rationale, source, violationPattern, alternatives });
      }
    }
  }

  return rules;
}

/** Regex fallback — original parser for environments without marked. */
function extractNamingRulesRegex(content: string, source: string): NamingRule[] {
  const rules: NamingRule[] = [];

  const sections = content.split(/^#+\s+/m);
  for (const section of sections) {
    if (!/naming\s+convention/i.test(section.split("\n")[0] ?? "")) continue;

    const lines = section.split("\n");
    let headerFound = false;

    for (const line of lines) {
      if (/^\s*\|.*Concept.*Name.*\|/i.test(line)) {
        headerFound = true;
        continue;
      }
      if (/^\s*\|[\s\-:|]+\|/.test(line)) continue;

      if (headerFound && /^\s*\|/.test(line)) {
        const cells = line.split("|").map(c => c.trim()).filter(Boolean);
        if (cells.length >= 2) {
          const concept = cells[0]!;
          const name = cells[1]!.replace(/`/g, "");
          const rationale = cells[2] ?? "";

          const alternatives = generateAlternatives(concept, name);
          const violationPattern = buildViolationPattern(name, alternatives);
          rules.push({ concept, name, rationale, source, violationPattern, alternatives });
        }
      }
    }
  }

  return rules;
}

// ── Alternative name generation ─────────────

/**
 * Generate common alternative names that would violate the convention.
 * e.g., if mandated name is "Restaurants", alternatives include:
 * "RestaurantList", "RestaurantsList", "restaurant_list"
 */
export function generateAlternatives(concept: string, mandatedName: string): string[] {
  const alts: string[] = [];
  const words = concept.split(/\s+/).filter(Boolean);

  if (words.length >= 2) {
    // PascalCase combinations
    const pascal = words.map(w => w[0]!.toUpperCase() + w.slice(1).toLowerCase()).join("");
    if (pascal !== mandatedName) alts.push(pascal);

    // camelCase
    const camel = words[0]!.toLowerCase() + words.slice(1).map(w => w[0]!.toUpperCase() + w.slice(1).toLowerCase()).join("");
    if (camel !== mandatedName && camel !== mandatedName.toLowerCase()) alts.push(camel);

    // snake_case
    const snake = words.map(w => w.toLowerCase()).join("_");
    if (snake !== mandatedName.toLowerCase()) alts.push(snake);

    // With common suffixes
    for (const suffix of ["List", "Array", "Collection", "Set", "Map", "Manager", "Handler", "Controller", "Service"]) {
      const withSuffix = words[0]![0]!.toUpperCase() + words[0]!.slice(1) + suffix;
      if (withSuffix !== mandatedName) alts.push(withSuffix);
    }
  } else {
    // Single word — generate with common suffixes
    // Only strip trailing 's' for simple plurals (avoid mangling "process", "address", etc.)
    const base = mandatedName.length > 4 && /[^s]s$/i.test(mandatedName)
      ? mandatedName.slice(0, -1)
      : mandatedName;
    for (const suffix of ["List", "Array", "Collection", "Manager", "Service"]) {
      const alt = base + suffix;
      if (alt !== mandatedName) alts.push(alt);
    }
  }

  return [...new Set(alts)].filter(a => a.length > 2);
}

/**
 * Build a regex pattern that matches any alternative (violation).
 */
function buildViolationPattern(mandatedName: string, alternatives: string[]): RegExp {
  if (alternatives.length === 0) return new RegExp(`$^`); // Never matches

  const escaped = alternatives.map(a => a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  // Match as identifier (word boundary or at class/function/type/interface declaration)
  return new RegExp(`\\b(${escaped.join("|")})\\b`);
}

// ── File discovery ──────────────────────────

function findMarkdownFiles(dir: string, maxDepth = 3, depth = 0): string[] {
  if (depth > maxDepth) return [];
  const results: string[] = [];

  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = resolve(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...findMarkdownFiles(fullPath, maxDepth, depth + 1));
      } else if (extname(entry.name) === ".md") {
        results.push(fullPath);
      }
    }
  } catch (err) { console.warn(`[blueprint-parser] skip inaccessible directory ${dir}: ${(err as Error).message}`); }

  return results;
}
