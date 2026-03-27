---
name: quorum:skill-authoring
description: "Create new quorum skills following the canonical + pointer wrapper architecture. Generates the shared skill at skills/{name}/ and adapter wrappers for all 4 adapters (claude-code, gemini, codex, openai-compatible). Use this skill whenever creating, scaffolding, or adding a new skill to the quorum project. Triggers on 'create skill', 'new skill', 'add skill', 'scaffold skill', '스킬 만들기', '스킬 추가', '새 스킬'."
argument-hint: "<skill name and purpose>"
---

# Quorum Skill Authoring Guide

Create skills that work across all 4 adapters with zero duplication.

## Architecture: 3-Layer Skill System

```
skills/{name}/                    ← Layer 1: Canonical (shared source of truth)
  ├── SKILL.md                    ← Business logic, no adapter-specific content
  └── references/                 ← Progressive-disclosure docs (optional)

adapters/{adapter}/skills/{name}/ ← Layer 2: Pointer Wrappers (per-adapter)
  └── SKILL.md                    ← Frontmatter + tool mapping + pointer to canonical

adapters/shared/tool-names.mjs    ← Layer 3: Tool name registry
```

**Principle**: Add once at `skills/`, reference everywhere. Adapter wrappers contain only what differs per adapter.

## Step 1 — Create Canonical Skill

Write `skills/{name}/SKILL.md`:

```markdown
---
name: quorum:{name}
description: "{what it does}. {when to trigger — be specific and slightly pushy}."
argument-hint: "<optional args>"
---

# {Skill Title}

{Brief purpose — 1-2 sentences}

## Workflow

1. **Step one** ...
2. **Step two** ...

## {Domain-specific sections}

...
```

### Canonical Rules

- **No `model` field** — adapters set their own model
- **No `allowed-tools` field** — adapters set their own tool permissions
- **No tool name references** — don't write `Read` or `read_file`; use generic verbs ("read the file", "search for")
- **No adapter paths** — don't use `${CLAUDE_PLUGIN_ROOT}` or `${GEMINI_EXTENSION_ROOT}`; use `{ADAPTER_ROOT}` placeholder if a path is needed
- **Use `quorum` CLI** for execution — `quorum audit`, `quorum tool code_map`, not `node path/to/script.mjs`
- **References** go in `skills/{name}/references/` — one file per sub-topic, read on demand

### Description Guidelines

The description is the primary trigger mechanism. Make it effective:

- Include both English and Korean trigger phrases
- List concrete user phrases, not abstract categories
- Be slightly "pushy" — Claude tends to under-trigger skills
- Include adjacent intents that should also trigger this skill

Good: `"... Use this skill whenever the user asks to visualize, diagram, chart, or draw anything. Triggers on 'draw', 'diagram', '다이어그램', '시각화'."`

Bad: `"Generate diagrams."`

## Step 2 — Create References (Optional)

For skills with multiple modes or complex syntax, split into reference files:

```
skills/{name}/references/
  ├── mode-a.md
  ├── mode-b.md
  └── advanced.md
```

The canonical SKILL.md should list references in a table and instruct when to read each one. References keep the main SKILL.md under ~100 lines while allowing deep detail on demand.

## Step 3 — Create Adapter Pointer Wrappers

Generate one wrapper per adapter. Each wrapper is ~20 lines:

### Template

```markdown
---
name: {adapter-name-format}
description: "{same as canonical}"
argument-hint: "{same as canonical}"
model: {adapter-model}
allowed-tools: {adapter-tool-list}
---

# {Skill Title} ({Adapter Name})

## Tool Mapping

| Operation | Tool |
|-----------|------|
| Read file | `{read}` |
| Write file | `{write}` |
| Find files | `{glob}` |
| Search content | `{grep}` |
| Run command | `{bash}` |

## Start

Read and follow the canonical skill at `skills/{name}/SKILL.md`.
```

### Adapter-Specific Values

| Field | claude-code | gemini | codex | openai-compatible |
|-------|-------------|--------|-------|-------------------|
| **name prefix** | `quorum:` | `quorum-` | `quorum-` | `quorum-` |
| **model** | `claude-sonnet-4-6` | `gemini-2.5-pro` | `codex` | _(omit)_ |
| **read** | `Read` | `read_file` | `read_file` | `read` |
| **write** | `Write` | `write_file` | `write_file` | `write` |
| **edit** | `Edit` | `edit_file` | `apply_diff` | `edit` |
| **glob** | `Glob` | `glob` | `find_files` | `glob` |
| **grep** | `Grep` | `grep` | `search` | `grep` |
| **bash** | `Bash` | `run_shell_command` | `shell` | `bash` |
| **agent** | `Agent` | `spawn_agent` | `create_agent` | `agent` |

Only include tools the skill actually needs in `allowed-tools` and the mapping table.

### Adapter-Specific Overrides

If a skill has adapter-specific execution (e.g., CLI paths), add it **below** the pointer:

```markdown
## Start

Read and follow the canonical skill at `skills/{name}/SKILL.md`.

## Execute

node ${CLAUDE_PLUGIN_ROOT}/core/{script}.mjs {{ arguments }}
```

Most skills don't need overrides — the pointer alone is sufficient.

## Step 4 — Verify

After creating all files, check:

1. `skills/{name}/SKILL.md` exists with no adapter-specific content
2. All 4 adapter wrappers exist and point to the canonical
3. Description is identical across canonical and all wrappers
4. References (if any) are only in `skills/{name}/references/`, not duplicated per adapter

### File Checklist

```
skills/{name}/SKILL.md                              ✓ canonical
skills/{name}/references/*.md                        ✓ shared refs (if needed)
adapters/claude-code/skills/{name}/SKILL.md          ✓ pointer wrapper
adapters/gemini/skills/{name}/SKILL.md               ✓ pointer wrapper
adapters/codex/skills/{name}/SKILL.md                ✓ pointer wrapper
adapters/openai-compatible/skills/{name}/SKILL.md    ✓ pointer wrapper
```

## Anti-Patterns

| Don't | Do |
|-------|----|
| Copy canonical body into wrapper | Point to canonical with one line |
| Put references in adapter directories | Put in `skills/{name}/references/` |
| Use adapter tool names in canonical | Use generic verbs or `quorum` CLI |
| Hardcode model in canonical | Let each adapter set its own model |
| Write different descriptions per adapter | Keep description identical everywhere |
| Create wrapper-only skills (no canonical) | Always start with canonical |
