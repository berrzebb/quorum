/**
 * skill-sync/index.mjs — Tool: skill_sync
 *
 * Detect and fix mismatches between canonical skills and adapter wrappers.
 * Extracted from tool-core.mjs (SPLIT-4).
 */
import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync as _writeFileSync } from "node:fs";
import { resolve, relative, dirname } from "node:path";
import { safePath, _cwd } from "../tool-utils.mjs";

// ═══ Adapter wrapper templates ═════════════════════════════════════════

const ADAPTER_CONFIGS = {
  "claude-code": {
    namePrefix: "quorum:",
    model: "claude-sonnet-4-6",
    title: "Claude Code",
    tools: { read: "Read", write: "Write", edit: "Edit", glob: "Glob", grep: "Grep", bash: "Bash" },
    allowedTools: (canonical) => {
      const ops = canonical.tools || ["read", "glob", "grep"];
      const parts = [];
      for (const op of ops) {
        if (op === "bash") { parts.push("Bash(node *)", "Bash(quorum *)"); }
        else { parts.push(ADAPTER_CONFIGS["claude-code"].tools[op] || op); }
      }
      return parts.join(", ");
    },
  },
  codex: {
    namePrefix: "quorum-",
    model: "codex",
    title: "Codex",
    tools: { read: "read_file", write: "write_file", edit: "apply_diff", glob: "find_files", grep: "search", bash: "shell" },
    allowedTools: (canonical) => {
      const ops = canonical.tools || ["read", "glob", "grep"];
      return ops.map(op => ADAPTER_CONFIGS.codex.tools[op] || op).join(", ");
    },
  },
  gemini: {
    namePrefix: "quorum-",
    model: "gemini-2.5-pro",
    title: "Gemini",
    tools: { read: "read_file", write: "write_file", edit: "edit_file", glob: "glob", grep: "grep", bash: "run_shell_command" },
    allowedTools: (canonical) => {
      const ops = canonical.tools || ["read", "glob", "grep"];
      return ops.map(op => ADAPTER_CONFIGS.gemini.tools[op] || op).join(", ");
    },
  },
  "openai-compatible": {
    namePrefix: "quorum-",
    model: null,
    title: "OpenAI-Compatible",
    tools: { read: "read", write: "write", edit: "edit", glob: "glob", grep: "grep", bash: "bash" },
    allowedTools: (canonical) => {
      const ops = canonical.tools || ["read", "glob", "grep"];
      return ops.map(op => ADAPTER_CONFIGS["openai-compatible"].tools[op] || op).join(", ");
    },
  },
};

// ═══ Helpers ═══════════════════════════════════════════════════════════

/**
 * Parse YAML frontmatter from a SKILL.md file.
 * @param {string} content
 * @returns {{ name: string, description: string, tools?: string[], [k:string]: any } | null}
 */
function parseSkillFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;
  const yaml = match[1];
  const result = {};
  for (const line of yaml.split("\n")) {
    const kv = line.match(/^(\w[\w-]*)\s*:\s*(.+)/);
    if (kv) {
      let val = kv[2].trim();
      // Strip quotes
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      // Parse array
      if (val.startsWith("[") && val.endsWith("]")) {
        val = val.slice(1, -1).split(",").map(s => s.trim()).filter(Boolean);
      }
      result[kv[1]] = val;
    }
    // Parse YAML list items (  - item)
    const listItem = line.match(/^\s+-\s+(.+)/);
    if (listItem) {
      const lastKey = Object.keys(result).pop();
      if (lastKey && !Array.isArray(result[lastKey])) {
        result[lastKey] = [];
      }
      if (lastKey) result[lastKey].push(listItem[1].trim());
    }
  }
  return result;
}

/**
 * Generate adapter wrapper content from canonical skill metadata.
 */
function generateWrapper(adapterName, canonical, skillName) {
  const cfg = ADAPTER_CONFIGS[adapterName];
  if (!cfg) return null;
  const name = `${cfg.namePrefix}${skillName}`;
  const modelLine = cfg.model ? `\nmodel: ${cfg.model}` : "";
  const argHint = canonical["argument-hint"] ? `\nargument-hint: "${canonical["argument-hint"]}"` : "";
  const allowed = cfg.allowedTools(canonical);

  const toolRows = Object.entries(cfg.tools)
    .filter(([op]) => !canonical.tools || canonical.tools.includes(op))
    .map(([op, native]) => `| ${op.charAt(0).toUpperCase() + op.slice(1)} file | \`${native}\` |`)
    .join("\n");

  // Fix operation labels
  const labelMap = { read: "Read file", write: "Write file", edit: "Edit file", glob: "Find files", grep: "Search content", bash: "Run command" };
  const rows = Object.entries(cfg.tools)
    .filter(([op]) => !canonical.tools || canonical.tools.includes(op))
    .map(([op, native]) => `| ${labelMap[op] || op} | \`${native}\` |`)
    .join("\n");

  return `---
name: ${name}
description: "${(canonical.description || "").replace(/"/g, '\\"')}"${argHint}${modelLine}
allowed-tools: ${allowed}
---

# ${skillName.split("-").map(w => w[0].toUpperCase() + w.slice(1)).join(" ")} (${cfg.title})

## ${cfg.title} Tool Mapping

| Operation | Tool |
|-----------|------|
${rows}

## Start

Read and follow the canonical skill at \`platform/skills/${skillName}/SKILL.md\`.
`;
}

// ═══ Tool: skill_sync ═══════════════════════════════════════════════════

/**
 * skill_sync — Detect and fix mismatches between canonical skills and adapter wrappers.
 *
 * @param {{ mode?: "check"|"fix", path?: string }} params
 * @returns {{ text: string, summary: string, json?: object } | { error: string }}
 */
export function toolSkillSync(params) {
  const { mode = "check" } = params;
  const repoRoot = params.path ? safePath(params.path) : _cwd;
  const skillsDir = resolve(repoRoot, "platform", "skills");
  const adaptersDir = resolve(repoRoot, "platform", "adapters");

  if (!existsSync(skillsDir)) return { error: `platform/skills/ directory not found at ${repoRoot}` };
  if (!existsSync(adaptersDir)) return { error: `platform/adapters/ directory not found at ${repoRoot}` };

  const ADAPTERS = ["claude-code", "codex", "gemini", "openai-compatible"];
  const results = { missing: [], outdated: [], synced: [], created: [], updated: [] };

  // Scan canonical skills
  let skillDirs;
  try { skillDirs = readdirSync(skillsDir, { withFileTypes: true }).filter(d => d.isDirectory()); }
  catch (err) { console.error("[skill-sync] skills readdir failed:", err?.message ?? err); return { error: `Cannot read platform/skills/ directory` }; }

  for (const dir of skillDirs) {
    const skillName = dir.name;
    const canonPath = resolve(skillsDir, skillName, "SKILL.md");
    if (!existsSync(canonPath)) continue;

    let canonContent;
    try { canonContent = readFileSync(canonPath, "utf8"); } catch (err) { console.warn("[skill-sync] SKILL.md read failed:", err?.message ?? err); continue; }
    const canonical = parseSkillFrontmatter(canonContent);
    if (!canonical || !canonical.name) continue;

    for (const adapter of ADAPTERS) {
      const wrapperPath = resolve(adaptersDir, adapter, "skills", skillName, "SKILL.md");
      const relWrapper = relative(repoRoot, wrapperPath).replace(/\\/g, "/");

      if (!existsSync(wrapperPath)) {
        results.missing.push({ skill: skillName, adapter, path: relWrapper });
        if (mode === "fix") {
          const content = generateWrapper(adapter, canonical, skillName);
          if (content) {
            mkdirSync(dirname(wrapperPath), { recursive: true });
            _writeFileSync(wrapperPath, content, "utf8");
            results.created.push({ skill: skillName, adapter, path: relWrapper });
          }
        }
        continue;
      }

      // Check description mismatch
      let wrapperContent;
      try { wrapperContent = readFileSync(wrapperPath, "utf8"); } catch (err) { console.warn("[skill-sync] wrapper SKILL.md read failed:", err?.message ?? err); continue; }
      const wrapper = parseSkillFrontmatter(wrapperContent);
      if (!wrapper) continue;

      if (canonical.description && wrapper.description !== canonical.description) {
        results.outdated.push({ skill: skillName, adapter, path: relWrapper, field: "description" });
        if (mode === "fix") {
          const updated = wrapperContent.replace(
            /^description:\s*"[^"]*"/m,
            `description: "${canonical.description.replace(/"/g, '\\"')}"`
          );
          _writeFileSync(wrapperPath, updated, "utf8");
          results.updated.push({ skill: skillName, adapter, path: relWrapper });
        }
      } else {
        results.synced.push({ skill: skillName, adapter });
      }
    }
  }

  // Format output
  const lines = [`# Skill Sync Report`, ``, `Mode: **${mode}**`, ``];

  if (results.missing.length > 0) {
    lines.push(`## Missing Wrappers (${results.missing.length})`, ``);
    lines.push(`| Skill | Adapter | Path |`, `|-------|---------|------|`);
    for (const m of results.missing) lines.push(`| ${m.skill} | ${m.adapter} | \`${m.path}\` |`);
    lines.push(``);
  }

  if (results.outdated.length > 0) {
    lines.push(`## Outdated Wrappers (${results.outdated.length})`, ``);
    lines.push(`| Skill | Adapter | Field |`, `|-------|---------|-------|`);
    for (const o of results.outdated) lines.push(`| ${o.skill} | ${o.adapter} | ${o.field} |`);
    lines.push(``);
  }

  if (mode === "fix" && (results.created.length + results.updated.length) > 0) {
    lines.push(`## Fixed`, ``);
    if (results.created.length > 0) {
      lines.push(`Created: ${results.created.length} wrappers`);
      for (const c of results.created) lines.push(`- \`${c.path}\``);
    }
    if (results.updated.length > 0) {
      lines.push(`Updated: ${results.updated.length} wrappers`);
      for (const u of results.updated) lines.push(`- \`${u.path}\``);
    }
    lines.push(``);
  }

  const total = skillDirs.filter(d => existsSync(resolve(skillsDir, d.name, "SKILL.md"))).length;
  lines.push(`## Summary`, ``);
  lines.push(`- Canonical skills: ${total}`);
  lines.push(`- Synced: ${results.synced.length} / ${total * ADAPTERS.length}`);
  lines.push(`- Missing: ${results.missing.length}`);
  lines.push(`- Outdated: ${results.outdated.length}`);

  const issues = results.missing.length + results.outdated.length;
  const summaryText = mode === "fix"
    ? `Fixed ${results.created.length} missing + ${results.updated.length} outdated wrappers`
    : `${issues === 0 ? "All synced" : `${issues} issues found`} across ${total} skills \u00d7 ${ADAPTERS.length} adapters`;

  return { text: lines.join("\n"), summary: summaryText, json: results };
}
