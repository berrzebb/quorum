/**
 * Skill Resolver — dynamic skill composition from knowledge base.
 *
 * Replaces 108 static adapter wrapper files with a single function:
 *   resolveSkill(skillName, adapter) → fully composed skill text
 *
 * Flow:
 *   1. Read canonical manifest (platform/skills/{name}/SKILL.md)
 *   2. Read referenced protocol (agents/knowledge/protocols/{name}.md)
 *   3. Apply adapter tool name mapping (tool-names.mjs)
 *   4. Return composed skill text ready for agent consumption
 */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { TOOL_MAP, getToolName } from "./tool-names.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** Repo root — 3 levels up from platform/adapters/shared/ */
const REPO_ROOT = resolve(__dirname, "..", "..", "..");
const SKILLS_DIR = resolve(REPO_ROOT, "platform", "skills");
const KNOWLEDGE_DIR = resolve(REPO_ROOT, "agents", "knowledge");

/**
 * Parse YAML frontmatter from a markdown file.
 * Returns { frontmatter: Record<string,string>, body: string }
 */
function parseFrontmatter(content) {
  if (!content.startsWith("---")) {
    return { frontmatter: {}, body: content };
  }
  const endIdx = content.indexOf("---", 3);
  if (endIdx === -1) {
    return { frontmatter: {}, body: content };
  }
  const yamlBlock = content.slice(3, endIdx).trim();
  const frontmatter = {};
  for (const line of yamlBlock.split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    let value = line.slice(colonIdx + 1).trim();
    // Strip surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    frontmatter[key] = value;
  }
  const body = content.slice(endIdx + 3).trim();
  return { frontmatter, body };
}

/**
 * Build an adapter-specific tool mapping table in markdown.
 *
 * @param {string} adapter — adapter name
 * @returns {string} Markdown table
 */
function buildToolTable(adapter) {
  const map = TOOL_MAP[adapter];
  if (!map) return "";
  const rows = Object.entries(map)
    .map(([canonical, native]) => `| ${canonical} | \`${native}\` |`);
  return [
    "",
    "## Tool Mapping",
    "",
    "| Operation | Tool |",
    "|-----------|------|",
    ...rows,
    "",
  ].join("\n");
}

/**
 * Resolve a skill for a specific adapter.
 *
 * @param {string} skillName — canonical skill name (e.g. "planner")
 * @param {string} adapter — adapter name (e.g. "claude-code", "codex", "gemini")
 * @returns {{ name: string, description: string, model: string, content: string } | null}
 */
export function resolveSkill(skillName, adapter) {
  const manifestPath = resolve(SKILLS_DIR, skillName, "SKILL.md");
  if (!existsSync(manifestPath)) return null;

  const manifestContent = readFileSync(manifestPath, "utf8");
  const { frontmatter, body } = parseFrontmatter(manifestContent);

  // Extract protocol reference from manifest body
  const protocolMatch = body.match(/protocols\/([a-z-]+)\.md/);
  let protocolContent = "";
  if (protocolMatch) {
    const protocolPath = resolve(KNOWLEDGE_DIR, "protocols", `${protocolMatch[1]}.md`);
    if (existsSync(protocolPath)) {
      protocolContent = readFileSync(protocolPath, "utf8");
    }
  }

  // Compose the full skill text
  const toolTable = buildToolTable(adapter);
  const adapterLabel = adapter.charAt(0).toUpperCase() + adapter.slice(1);

  // Adapter-specific name convention
  const namePrefix = adapter === "claude-code" ? "quorum:" : "quorum-";
  const resolvedName = frontmatter.name?.replace(/^quorum[:-]/, namePrefix) ||
                       `${namePrefix}${skillName}`;

  const composed = [
    `# ${resolvedName}`,
    "",
    frontmatter.description ? `> ${frontmatter.description}` : "",
    "",
    protocolContent,
    toolTable,
  ].filter(Boolean).join("\n");

  return {
    name: resolvedName,
    description: frontmatter.description || "",
    model: frontmatter.model || "",
    content: composed,
  };
}

/**
 * Resolve a protocol directly (for on-demand/harness-generated skills).
 *
 * @param {string} protocolName — protocol file name without .md (e.g. "fixer")
 * @param {string} adapter — adapter name
 * @returns {{ content: string, toolTable: string } | null}
 */
export function resolveProtocol(protocolName, adapter) {
  const protocolPath = resolve(KNOWLEDGE_DIR, "protocols", `${protocolName}.md`);
  if (!existsSync(protocolPath)) return null;

  const content = readFileSync(protocolPath, "utf8");
  const toolTable = buildToolTable(adapter);

  return { content, toolTable };
}

/**
 * List all available protocols (for harness discovery).
 *
 * @returns {string[]} Protocol names (without .md extension)
 */
export function listProtocols() {
  const dir = resolve(KNOWLEDGE_DIR, "protocols");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(f => f.endsWith(".md"))
    .map(f => f.replace(".md", ""));
}

/**
 * List all available domain knowledge files (for harness discovery).
 *
 * @returns {string[]} Domain names (without .md extension)
 */
export function listDomains() {
  const dir = resolve(KNOWLEDGE_DIR, "domains");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(f => f.endsWith(".md"))
    .map(f => f.replace(".md", ""));
}
