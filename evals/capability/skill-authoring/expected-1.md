# Expected Quality Standards — Skill Authoring

1. **Correct SKILL.md Frontmatter**: The canonical `platform/skills/dependency-audit/SKILL.md` must include YAML frontmatter with at minimum: `name: dependency-audit`, `description` (clear one-line purpose), and `version`. The frontmatter must be valid YAML between `---` delimiters.

2. **Protocol References**: The skill must reference relevant shared protocols from `agents/knowledge/`. For a dependency audit skill, this should reference at minimum `specialist-base.md` (for JSON output format and judgment criteria) and `tool-inventory.md` (for available MCP tools). References should be in a `references/` subdirectory or inline links.

3. **Execution Workflow Steps**: The SKILL.md must define a numbered or ordered list of execution steps that describe the skill's workflow. For dependency-audit, this should include: (a) read package.json / lock files, (b) check packages against vulnerability databases, (c) classify severity levels, (d) generate findings report, (e) suggest remediation actions.

4. **Completion Gate**: The skill must define explicit completion gate conditions — what must be true for the skill to report "done." For dependency-audit: all dependencies checked, severity classified, report generated with zero unhandled errors.

5. **Adapter Wrappers for All 3 Adapters**: The skill must create wrapper files under:
   - `platform/adapters/claude-code/skills/dependency-audit.md`
   - `platform/adapters/gemini/skills/dependency-audit.md`
   - `platform/adapters/codex/skills/dependency-audit.md`
   Each wrapper maps adapter-specific tool names (e.g., Bash vs shell vs execute) and references the canonical SKILL.md.

6. **Protocol-Neutral Inheritance**: The architecture must follow the 3-layer pattern: `agents/knowledge/` (shared protocols) → `platform/skills/dependency-audit/` (canonical implementation) → adapter wrappers (tool bindings only). Domain logic must not be duplicated across adapters.

7. **Tool Binding Correctness**: Each adapter wrapper must use the correct tool names for its platform. Claude Code uses `Bash`, `Read`, `Write`; Gemini uses `shell`, `read_file`, `write_file`; Codex uses `execute`, `read`, `write`. Tool name mapping must be consistent with `platform/adapters/shared/tool-names.mjs`.

8. **Output Format Compliance**: The skill's output must follow the specialist JSON output format defined in `specialist-base.md`: structured findings with severity, location, description, and suggested fix. This ensures the output integrates with the audit pipeline.
