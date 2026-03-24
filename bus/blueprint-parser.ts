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
 */
export function extractNamingRules(content: string, source: string = "blueprint.md"): NamingRule[] {
  const rules: NamingRule[] = [];

  // Find "Naming Conventions" section (case-insensitive)
  const sections = content.split(/^#+\s+/m);
  for (const section of sections) {
    if (!/naming\s+convention/i.test(section.split("\n")[0] ?? "")) continue;

    // Parse markdown table rows
    const lines = section.split("\n");
    let headerFound = false;

    for (const line of lines) {
      // Skip header row and separator
      if (/^\s*\|.*Concept.*Name.*\|/i.test(line)) {
        headerFound = true;
        continue;
      }
      if (/^\s*\|[\s\-:|]+\|/.test(line)) continue;

      // Parse data rows
      if (headerFound && /^\s*\|/.test(line)) {
        const cells = line.split("|").map(c => c.trim()).filter(Boolean);
        if (cells.length >= 2) {
          const concept = cells[0]!;
          const name = cells[1]!.replace(/`/g, ""); // Strip backticks
          const rationale = cells[2] ?? "";

          // Generate violation patterns — common wrong-name variants
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
    const base = mandatedName.replace(/s$/i, ""); // Remove trailing 's'
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
  } catch { /* skip inaccessible directories */ }

  return results;
}
