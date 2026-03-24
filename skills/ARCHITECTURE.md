# Skill Architecture

## Directory Structure

```
skills/                          ← Shared skills (source of truth)
  ├── {skill}/SKILL.md           ← Skill definition
  └── {skill}/references/        ← Progressive-disclosure references

adapters/claude-code/skills/     ← HARD LINKS to skills/ (same inode)
adapters/gemini/skills/          ← Adapter-specific copies (Gemini tool names)
adapters/codex/skills/           ← Adapter-specific copies (Codex tool names)

agents/knowledge/                ← Cross-adapter protocols (business logic)
  ├── implementer-protocol.md    ← Execution flow, correction, completion gate
  ├── scout-protocol.md          ← RTM generation 8-phase
  ├── specialist-base.md         ← JSON output format, judgment criteria
  ├── ui-review-protocol.md      ← UI-1~8 checklist, report format
  ├── doc-sync-protocol.md       ← 3-layer sync, fact extraction
  ├── tool-inventory.md          ← 20-tool catalog
  └── domains/*.md               ← Domain knowledge (perf, a11y, ...)
```

## Inheritance Model

```
agents/knowledge/ (protocols)     ← Business logic, adapter-independent
        ↓ referenced by
skills/ (shared skills)           ← Full skill + references (source of truth)
        ↓ hard-linked to
adapters/claude-code/skills/      ← Same files, Claude Code tool names

        ↓ adapted as
adapters/gemini/skills/           ← Gemini tool names + protocol refs
adapters/codex/skills/            ← Codex tool names + protocol refs
```

## shared ↔ claude-code Relationship

`adapters/claude-code/skills/` files are **hard links** to `skills/`. They share the same inode — editing either location modifies both.

This means:
- **Edit `skills/` only** — changes propagate to Claude Code automatically
- **Never create new files in `adapters/claude-code/skills/`** — create in `skills/` first, then hard-link
- **References** (`skills/*/references/`) are also hard-linked

To create a hard link for a new skill:
```bash
# After creating skills/new-skill/SKILL.md
mkdir -p adapters/claude-code/skills/new-skill
ln skills/new-skill/SKILL.md adapters/claude-code/skills/new-skill/SKILL.md
```

## Adapter Skill Template

Gemini and Codex skills follow a standard template — protocol reference + tool binding:

```yaml
---
name: quorum-{skill-name}
description: "{what it does}. {when to use}. Triggers on '{keyword1}', '{keyword2}'."
model: {gemini-2.5-pro | codex}
allowed-tools: {adapter-native tool names}
---
```

```markdown
# {Skill Title} ({Adapter})

{One-line purpose statement.}

## {Adapter} Tool Mapping

| Operation | Tool |
|-----------|------|
| Read file | `read_file` |
| Write file | `write_file` |
| ... | ... |

## Core Protocol

Read and follow: `agents/knowledge/{protocol}.md`

## Tool References

For detailed parameters: `skills/consensus-tools/references/`

## {Adapter-specific sections only}
...
```

**Keep adapter skills thin** — business logic belongs in `agents/knowledge/`, tool parameters in `skills/*/references/`. Adapter skills contain only:
1. Frontmatter (name, description, model, allowed-tools)
2. Tool Mapping table
3. Protocol reference pointer
4. Adapter-specific behavior (if any)

## Reference Resolution

Shared references live in `skills/{skill-name}/references/`. Adapter skills reference them by path:

| Adapter | How to reference |
|---------|-----------------|
| Claude Code | `references/xxx.md` (hard-linked, resolves locally) |
| Gemini | `skills/{skill}/references/xxx.md` (project-root relative) |
| Codex | `skills/{skill}/references/xxx.md` (project-root relative) |

## Adding a New Skill

1. Create `skills/{name}/SKILL.md` with full content
2. Create `skills/{name}/references/` if progressive disclosure needed
3. Hard-link to Claude Code: `ln skills/{name}/SKILL.md adapters/claude-code/skills/{name}/SKILL.md`
4. Create Gemini adapter: `adapters/gemini/skills/{name}/SKILL.md` (tool mapping + protocol ref)
5. Create Codex adapter: `adapters/codex/skills/{name}/SKILL.md` (tool mapping + protocol ref)
6. Update `CLAUDE.md` skill counts

## Adding a New Adapter

1. Create `adapters/{name}/skills/` directory
2. For each shared skill, create adapter version with:
   - Adapter-native tool names (from `adapters/shared/tool-names.mjs`)
   - Protocol references (`agents/knowledge/`)
   - Shared reference paths (`skills/*/references/`)
3. Register tool names in `adapters/shared/tool-names.mjs`
4. Create hooks in `adapters/{name}/hooks/hooks.json`
