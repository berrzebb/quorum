---
name: quorum:skill-authoring
description: "Create new quorum skills with eval as a set — generates canonical skill, 4 adapter wrappers, AND eval definition (eval.yaml + prompt + expected). Use this skill whenever creating, scaffolding, or adding a new skill to the quorum project. Triggers on 'create skill', 'new skill', 'add skill', 'scaffold skill', '스킬 만들기', '스킬 추가', '새 스킬'."
argument-hint: "<skill name and purpose>"
---

# Quorum Skill Authoring Guide

Create skills that work across all 4 adapters with zero duplication.

## Architecture: 3-Layer Skill System

```
skills/{name}/                    ← Layer 1: Canonical (shared source of truth)
  ├── SKILL.md                    ← Business logic, no adapter-specific content
  └── references/                 ← Progressive-disclosure docs (optional)

platform/adapters/{adapter}/skills/{name}/ ← Layer 2: Pointer Wrappers (per-adapter)
  └── SKILL.md                    ← Frontmatter + tool mapping + pointer to canonical

platform/adapters/shared/tool-names.mjs    ← Layer 3: Tool name registry
```

**Principle**: Add once at `platform/skills/`, reference everywhere. Adapter wrappers contain only what differs per adapter.

## Step 1 — Create Canonical Skill

Write `platform/skills/{name}/SKILL.md`:

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
- **No adapter paths** — don't use adapter-specific env vars (e.g. `CLAUDE_PLUGIN_ROOT`, `GEMINI_EXTENSION_ROOT`); use `{ADAPTER_ROOT}` placeholder if a path is needed
- **Use `quorum` CLI** for execution — `quorum audit`, `quorum tool code_map`, not `node path/to/script.mjs`
- **References** go in `platform/skills/{name}/references/` — one file per sub-topic, read on demand

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

Read and follow the canonical skill at `platform/skills/{name}/SKILL.md`.
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

Read and follow the canonical skill at `platform/skills/{name}/SKILL.md`.

## Execute

quorum tool {tool_name} {{ arguments }}
```

Most skills don't need overrides — the pointer alone is sufficient.

## Step 4 — Create Eval Definition

Every skill MUST have an eval. Skills and evals are created as a **set** — a skill without an eval is incomplete.

### Classification

Determine the skill's eval classification:

| Classification | When | Parity Test |
|---------------|------|-------------|
| **workflow** | The skill enforces a procedure (step sequence matters) | No |
| **capability** | The skill produces an output (quality matters) | Yes |

### Create 3 Files

```
evals/{classification}/{name}/
  ├── eval.yaml       ← criteria definition + parity config
  ├── prompt-1.md     ← test scenario (realistic user request)
  └── expected-1.md   ← expected procedure steps OR quality standards
```

### eval.yaml Template

```yaml
name: {name}
classification: {workflow|capability}
version: 0.4.8
description: "{skill name} {classification type} evaluation"

evals:
  - name: {output-quality|procedure-compliance}
    prompt: prompt-1.md
    expected: expected-1.md
    criteria:
      - "{What the skill MUST do — be specific}"
      - "{Another verifiable criterion}"
      - "{3-8 criteria total}"
    timeout: 60000

parity:
  enabled: {true for capability, false for workflow}
  description: "Tests if model can perform equally well without this skill"

benchmark:
  model_baseline: "claude-sonnet-4-6"
  metrics:
    - {procedure_compliance|output_quality}
    - {model_parity (capability only)}
```

### prompt-1.md Guidelines

- Describe a **realistic scenario** the skill would handle
- Include enough context (config values, file paths, project state)
- Write as if a real user is invoking the skill

### expected-1.md Guidelines

- **Workflow**: List numbered procedure steps (10-25 steps)
- **Capability**: List quality standards with descriptions (4-8 standards)
- Include keywords that match the criteria in eval.yaml (the runner uses keyword matching)
- Be specific enough that the eval runner can verify coverage

### Verify Eval

Run the eval to confirm it passes:

```bash
node evals/runner.mjs --skill {name}
```

## Step 5 — Verify

After creating all files, check:

1. `platform/skills/{name}/SKILL.md` exists with no adapter-specific content
2. All 4 adapter wrappers exist and point to the canonical
3. Description is identical across canonical and all wrappers
4. References (if any) are only in `platform/skills/{name}/references/`, not duplicated per adapter
5. **Eval exists** at `evals/{classification}/{name}/` with all 3 files
6. **Eval passes**: `node evals/runner.mjs --skill {name}` exits 0

### File Checklist

```
skills/{name}/SKILL.md                              ✓ canonical
skills/{name}/references/*.md                        ✓ shared refs (if needed)
adapters/claude-code/skills/{name}/SKILL.md          ✓ pointer wrapper
adapters/gemini/skills/{name}/SKILL.md               ✓ pointer wrapper
adapters/codex/skills/{name}/SKILL.md                ✓ pointer wrapper
adapters/openai-compatible/skills/{name}/SKILL.md    ✓ pointer wrapper
evals/{classification}/{name}/eval.yaml              ✓ eval definition
evals/{classification}/{name}/prompt-1.md            ✓ test scenario
evals/{classification}/{name}/expected-1.md          ✓ expected output
```

## Anti-Patterns

| Don't | Do |
|-------|----|
| Copy canonical body into wrapper | Point to canonical with one line |
| Put references in adapter directories | Put in `platform/skills/{name}/references/` |
| Use adapter tool names in canonical | Use generic verbs or `quorum` CLI |
| Hardcode model in canonical | Let each adapter set its own model |
| Write different descriptions per adapter | Keep description identical everywhere |
| Create wrapper-only skills (no canonical) | Always start with canonical |
| Create skill without eval | Always create eval as a set |
| Skip eval verification | Run `node evals/runner.mjs --skill {name}` |
