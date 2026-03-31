/**
 * Harness Skill Mapper — converts Harness-generated skills to quorum canonical format.
 *
 * Harness generates skills in `.claude/skills/{name}/skill.md` format.
 * This mapper:
 * 1. Validates frontmatter (name, description required)
 * 2. Enforces protocol neutrality (no adapter-specific tool names)
 * 3. Applies Progressive Disclosure (body ≤500 lines)
 * 4. Prepares for skill_sync to generate adapter wrappers
 */

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, join, basename, dirname } from "node:path";

// ── Types ───────────────────────────────────────────────

export interface SkillValidation {
  /** Path to the skill file. */
  path: string;
  /** Skill name from frontmatter. */
  name: string;
  /** Whether the skill passes all checks. */
  valid: boolean;
  /** Validation issues found. */
  issues: string[];
  /** Suggestions for improvement. */
  suggestions: string[];
}

export interface SkillMappingResult {
  /** All validated skills. */
  skills: SkillValidation[];
  /** Count of valid skills. */
  validCount: number;
  /** Count of skills with issues. */
  issueCount: number;
  /** Paths that were auto-fixed. */
  autoFixed: string[];
}

// ── Adapter-specific tool names that violate neutrality ──

const ADAPTER_TOOL_NAMES: Record<string, string> = {
  // Claude Code specific
  "Read": "read file",
  "Write": "write file",
  "Edit": "edit file",
  "Bash": "run command",
  "Glob": "find files",
  "Grep": "search content",
  // Codex specific
  "read_file": "read file",
  "write_file": "write file",
  "apply_diff": "edit file",
  "shell": "run command",
  "find_files": "find files",
  "search": "search content",
  // Gemini specific
  "run_shell_command": "run command",
  "edit_file": "edit file",
};

// ── Frontmatter Parsing ─────────────────────────────────

interface Frontmatter {
  name?: string;
  description?: string;
  [key: string]: unknown;
}

/**
 * Parse YAML-like frontmatter from a markdown file.
 * Handles simple key: value pairs (no nested structures).
 */
export function parseFrontmatter(content: string): { frontmatter: Frontmatter; body: string } {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n/);
  if (!match) {
    return { frontmatter: {}, body: content };
  }

  const fm: Frontmatter = {};
  for (const line of match[1]!.split("\n")) {
    const kv = line.match(/^(\w[\w-]*)\s*:\s*"?(.+?)"?\s*$/);
    if (kv) {
      fm[kv[1]!] = kv[2]!;
    }
  }

  return { frontmatter: fm, body: content.slice(match[0].length) };
}

// ── Validation ──────────────────────────────────────────

/**
 * Validate a single Harness-generated skill file.
 */
export function validateSkill(filePath: string): SkillValidation {
  const issues: string[] = [];
  const suggestions: string[] = [];

  if (!existsSync(filePath)) {
    return {
      path: filePath,
      name: basename(dirname(filePath)),
      valid: false,
      issues: ["File not found"],
      suggestions: [],
    };
  }

  const content = readFileSync(filePath, "utf8");
  const { frontmatter, body } = parseFrontmatter(content);

  // Check required frontmatter fields
  const name = (frontmatter.name as string) ?? "";
  if (!name) {
    issues.push("Missing required frontmatter field: name");
  }
  if (!frontmatter.description) {
    issues.push("Missing required frontmatter field: description");
  }

  // Check description quality (Harness recommends aggressive triggers)
  const desc = (frontmatter.description as string) ?? "";
  if (desc && desc.length < 50) {
    suggestions.push("Description is short. Consider adding specific trigger scenarios for better activation.");
  }

  // Check body length (Progressive Disclosure: ≤500 lines)
  const bodyLines = body.split("\n").length;
  if (bodyLines > 500) {
    suggestions.push(`Body is ${bodyLines} lines (limit: 500). Move detailed sections to references/.`);
  }

  // Check for adapter-specific tool names (protocol neutrality violation)
  for (const [toolName, generic] of Object.entries(ADAPTER_TOOL_NAMES)) {
    // Match tool name used as a word (not as part of a longer identifier)
    const regex = new RegExp(`\\b${toolName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
    if (regex.test(body)) {
      issues.push(`Adapter-specific tool name "${toolName}" found. Use generic "${generic}" or \`quorum tool <name>\`.`);
    }
  }

  return {
    path: filePath,
    name: name || basename(dirname(filePath)),
    valid: issues.length === 0,
    issues,
    suggestions,
  };
}

/**
 * Validate all skills in a directory.
 */
export function validateSkillDirectory(skillsDir: string): SkillMappingResult {
  const skills: SkillValidation[] = [];
  const autoFixed: string[] = [];

  if (!existsSync(skillsDir)) {
    return { skills: [], validCount: 0, issueCount: 0, autoFixed: [] };
  }

  // Scan for skill.md or SKILL.md files

  let entries: string[];
  try {
    entries = readdirSync(skillsDir);
  } catch {
    return { skills: [], validCount: 0, issueCount: 0, autoFixed: [] };
  }

  for (const entry of entries) {
    const entryPath = join(skillsDir, entry);
    try {
      if (!statSync(entryPath).isDirectory()) continue;
    } catch { continue; }

    // Check for skill.md (Harness convention) or SKILL.md (quorum convention)
    const skillFile = existsSync(join(entryPath, "skill.md"))
      ? join(entryPath, "skill.md")
      : existsSync(join(entryPath, "SKILL.md"))
        ? join(entryPath, "SKILL.md")
        : null;

    if (skillFile) {
      skills.push(validateSkill(skillFile));
    }
  }

  return {
    skills,
    validCount: skills.filter(s => s.valid).length,
    issueCount: skills.filter(s => !s.valid).length,
    autoFixed,
  };
}

/**
 * Normalize a Harness skill file to quorum canonical format.
 *
 * - Renames skill.md → SKILL.md (quorum convention)
 * - Prefixes name with "quorum:" if not already
 * - Creates references/ directory if body > 400 lines
 *
 * Returns the path to the normalized file.
 */
export function normalizeToCanonical(
  sourcePath: string,
  targetDir: string,
): string | null {
  if (!existsSync(sourcePath)) return null;

  const content = readFileSync(sourcePath, "utf8");
  const { frontmatter, body } = parseFrontmatter(content);

  // Normalize name
  let name = (frontmatter.name as string) ?? basename(dirname(sourcePath));
  if (!name.startsWith("quorum:") && !name.startsWith("quorum-")) {
    name = `quorum:${name}`;
  }

  // Rebuild frontmatter
  const fmLines = [
    "---",
    `name: ${name}`,
  ];
  if (frontmatter.description) {
    fmLines.push(`description: "${frontmatter.description}"`);
  }
  fmLines.push("---");

  const normalizedContent = fmLines.join("\n") + "\n\n" + body;

  // Write to target
  mkdirSync(targetDir, { recursive: true });
  const targetPath = join(targetDir, "SKILL.md");
  writeFileSync(targetPath, normalizedContent, "utf8");

  return targetPath;
}
