# Skill Architecture

## Directory Structure

```
skills/                          ← Protocol-neutral canonical definitions (source of truth)
  ├── {skill}/SKILL.md           ← What the skill does (no adapter-specific content)
  ├── {skill}/references/        ← Progressive-disclosure references
  └── ARCHITECTURE.md            ← This file

adapters/claude-code/skills/     ← Claude Code wrappers (Read/Write/Edit/Bash/Glob/Grep)
adapters/gemini/skills/          ← Gemini wrappers (read_file/write_file/shell/glob/grep)
adapters/codex/skills/           ← Codex wrappers (read_file/write_file/apply_diff/shell/find_files/search)

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
skills/ (canonical skills)        ← Protocol-neutral definitions + references
        ↓ adapted by (all 3 adapters are equal peers)
adapters/claude-code/skills/      ← Claude Code tool names + adapter paths
adapters/gemini/skills/           ← Gemini tool names + adapter paths
adapters/codex/skills/            ← Codex tool names + adapter paths
```

## Protocol Neutrality

`skills/` contains **protocol-neutral** canonical skill definitions:
- Define WHAT the skill does (phases, rules, constraints)
- NO adapter-specific tool names (not `Read`, not `read_file`, not `apply_diff`)
- NO adapter-specific paths (not `${CLAUDE_PLUGIN_ROOT}`)
- Use `quorum tool <name>` for generic tool invocation
- Use `{ADAPTER_ROOT}` as placeholder where adapter path is needed
- References use local relative paths (`references/xxx.md`)

All three adapters are **equal peers** — each creates its own wrapper with:
- Adapter-native tool mapping table
- Adapter-specific invocation paths
- Protocol references to `agents/knowledge/` and `skills/*/references/`

## Adapter Skill Template

All adapter skills follow the same pattern — tool mapping + protocol reference:

```yaml
---
name: quorum:{name}          # CC uses quorum:, Gemini/Codex use quorum-
description: "..."
model: {adapter-model}
allowed-tools: {adapter-native tool names}
---
```

```markdown
# {Skill Title} ({Adapter Name})

{One-line purpose}

## {Adapter} Tool Mapping

| Operation | Tool |
|-----------|------|
| Read file | `{native name}` |
| Write file | `{native name}` |
| ... | ... |

## Core Protocol
Read and follow: `agents/knowledge/{protocol}.md`

## Tool References
For detailed parameters: `skills/consensus-tools/references/`
```

**Keep adapter skills thin** — business logic in `agents/knowledge/`, tool details in `skills/*/references/`. Adapter skills contain only:
1. Frontmatter (name, description, model, allowed-tools)
2. Tool Mapping table
3. Protocol reference pointer
4. Adapter-specific behavior (if any)

## Reference Resolution

References live in `skills/{skill-name}/references/`. All adapters reference by project-root path:

```
skills/{skill}/references/xxx.md
```

Consistent across all 3 adapters — no special cases.

## Adding a New Skill

1. Create `skills/{name}/SKILL.md` with protocol-neutral content
2. Create `skills/{name}/references/` if progressive disclosure needed
3. Create adapter wrappers (all 3):
   - `adapters/claude-code/skills/{name}/SKILL.md` (Read/Write/Edit/Bash/Glob/Grep)
   - `adapters/gemini/skills/{name}/SKILL.md` (read_file/write_file/edit_file/shell/glob/grep)
   - `adapters/codex/skills/{name}/SKILL.md` (read_file/write_file/apply_diff/shell/find_files/search)
4. Update `CLAUDE.md` skill counts

## Adding a New Adapter

1. Create `adapters/{name}/skills/` directory
2. For each shared skill, create adapter version with:
   - Adapter-native tool names (from `adapters/shared/tool-names.mjs`)
   - Protocol references (`agents/knowledge/`)
   - Shared reference paths (`skills/*/references/`)
3. Register tool names in `adapters/shared/tool-names.mjs`
4. Create hooks in `adapters/{name}/hooks/hooks.json`
