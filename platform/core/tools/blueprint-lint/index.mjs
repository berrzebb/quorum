/**
 * blueprint-lint — Check source code against Blueprint naming conventions.
 * Extracted from tool-core.mjs (SPLIT-3).
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { _langRegistry, runPatternScan } from "../tool-utils.mjs";
import { parseTableCells } from "../../markdown-table-parser.mjs";

/**
 * Check source code against Blueprint naming conventions.
 * Parses naming tables from design/ Blueprint markdown, then scans source files
 * for identifiers that violate the mandated names.
 *
 * @param {{ design_dir?: string, path?: string }} params
 */
export function toolBlueprintLint(params) {
  const cwd = process.cwd();
  const designDir = params.design_dir
    ? resolve(params.design_dir)
    : resolve(cwd, "docs", "design");
  const targetPath = params.path ? resolve(params.path) : cwd;

  // Inline minimal parser (always used — no compiled parser dependency)
  const parseBlueprints = (dir) => {
    const rules = [];
    try {
      const files = _walkMarkdown(dir);
      for (const file of files) {
        const content = readFileSync(file, "utf8");
        rules.push(..._extractNamingRulesInline(content, file));
      }
    } catch (err) { console.warn("[tool-core] operation failed:", err?.message ?? err); }
    return { rules, sources: [] };
  };

  const { rules, sources } = parseBlueprints(designDir);

  if (rules.length === 0) {
    return {
      text: `## Blueprint Naming Lint\n\nNo naming conventions found in ${designDir}.\nCreate a Blueprint with a "Naming Conventions" table to enforce naming.`,
      summary: "blueprint_lint: no rules found",
      json: { total: 0, violations: 0, findings: [] },
    };
  }

  // Convert rules to patterns for runPatternScan
  const patterns = [];
  for (const rule of rules) {
    if (rule.alternatives && rule.alternatives.length > 0) {
      for (const alt of rule.alternatives) {
        const escaped = alt.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        patterns.push({
          re: new RegExp(`\\b${escaped}\\b`),
          label: `naming-violation:${rule.name}`,
          severity: "high",
          msg: `Should be "${rule.name}" per Blueprint (concept: "${rule.concept}"). ${rule.rationale}`,
        });
      }
    }
  }

  if (patterns.length === 0) {
    return {
      text: `## Blueprint Naming Lint\n\n${rules.length} naming rules found, but no violation patterns generated.\nRules: ${rules.map(r => `${r.concept} → ${r.name}`).join(", ")}`,
      summary: `blueprint_lint: ${rules.length} rules, 0 patterns`,
      json: { total: rules.length, violations: 0, findings: [] },
    };
  }

  const result = runPatternScan({
    targetPath,
    extensions: _langRegistry?.extensionsForDomain("perf") ?? new Set([".ts", ".tsx", ".js", ".jsx", ".mjs"]),
    patterns,
    toolName: "blueprint_lint",
    heading: "Blueprint Naming Violations",
    passMsg: `all identifiers follow Blueprint naming conventions (${rules.length} rules)`,
    failNoun: "naming violation(s)",
  });

  // Add rules summary to output
  const rulesSummary = rules.map(r => `| ${r.concept} | \`${r.name}\` | ${r.rationale} |`).join("\n");
  result.text = `## Active Naming Rules\n\n| Concept | Mandated Name | Rationale |\n|---------|--------------|-----------||\n${rulesSummary}\n\n${result.text}`;

  return result;
}

// Inline helpers for fail-open mode (when blueprint-parser.ts is unavailable)
function _walkMarkdown(dir, depth = 0) {
  if (depth > 3 || !existsSync(dir)) return [];
  const results = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) results.push(..._walkMarkdown(full, depth + 1));
    else if (entry.name.endsWith(".md")) results.push(full);
  }
  return results;
}

function _extractNamingRulesInline(content, source) {
  const rules = [];
  const sections = content.split(/^#+\s+/m);
  for (const section of sections) {
    if (!/naming\s+convention/i.test(section.split("\n")[0] || "")) continue;
    let headerFound = false;
    for (const line of section.split("\n")) {
      if (/^\s*\|.*Concept.*Name.*\|/i.test(line)) { headerFound = true; continue; }
      if (/^\s*\|[\s\-:|]+\|/.test(line)) continue;
      if (headerFound && /^\s*\|/.test(line)) {
        const cells = parseTableCells(line).filter(Boolean);
        if (cells.length >= 2) {
          const concept = cells[0];
          const name = cells[1].replace(/`/g, "");
          const rationale = cells[2] || "";
          const alternatives = _genAlts(concept, name);
          rules.push({ concept, name, rationale, source, alternatives });
        }
      }
    }
  }
  return rules;
}

function _genAlts(concept, name) {
  const alts = [];
  const words = concept.split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    const pascal = words.map(w => w[0].toUpperCase() + w.slice(1).toLowerCase()).join("");
    if (pascal !== name) alts.push(pascal);
    const camel = words[0].toLowerCase() + words.slice(1).map(w => w[0].toUpperCase() + w.slice(1).toLowerCase()).join("");
    if (camel !== name) alts.push(camel);
    for (const suffix of ["List", "Array", "Collection", "Manager", "Service", "Set", "Map", "Handler", "Controller"]) {
      const alt = words[0][0].toUpperCase() + words[0].slice(1) + suffix;
      if (alt !== name) alts.push(alt);
    }
  }
  return [...new Set(alts)].filter(a => a.length > 2);
}
