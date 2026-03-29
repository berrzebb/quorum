# Skill Architecture

## Directory Structure

```
platform/skills/                 ← Protocol-neutral canonical definitions (source of truth)
  ├── {skill}/SKILL.md           ← What the skill does (no adapter-specific content)
  ├── {skill}/references/        ← Progressive-disclosure references
  └── ARCHITECTURE.md            ← This file

platform/adapters/claude-code/skills/     ← Claude Code wrappers (Read/Write/Edit/Bash/Glob/Grep)
platform/adapters/gemini/skills/          ← Gemini wrappers (read_file/write_file/shell/glob/grep)
platform/adapters/codex/skills/           ← Codex wrappers (read_file/write_file/apply_diff/shell/find_files/search)

agents/knowledge/                ← Retained shared protocol corpus (stable, adapter-neutral)
  ├── implementer-protocol.md    ← Execution flow, correction, completion gate
  ├── scout-protocol.md          ← RTM generation 8-phase
  ├── specialist-base.md         ← JSON output format, judgment criteria
  ├── ui-review-protocol.md      ← UI-1~8 checklist, report format
  ├── doc-sync-protocol.md       ← 3-layer sync, fact extraction
  ├── parliament-rules.md        ← Standing rules for parliamentary deliberation
  ├── tool-inventory.md          ← 26-tool catalog
  ├── domains/*.md               ← Domain knowledge (11 domains)
  └── README.md                  ← Taxonomy, ownership rules, stability contract
```

## Inheritance Model

```
agents/knowledge/ (protocols)     ← Stable protocol corpus, adapter-independent
        ↓ referenced by
platform/skills/ (canonical)      ← Protocol-neutral definitions + references
        ↓ adapted by (all 4 adapters are equal peers)
platform/adapters/claude-code/skills/      ← Claude Code tool names + adapter paths
platform/adapters/gemini/skills/           ← Gemini tool names + adapter paths
platform/adapters/codex/skills/            ← Codex tool names + adapter paths
```

### Why `agents/knowledge/` Lives at Root

`agents/knowledge/` is a **retained shared protocol corpus**, not a residual source tree awaiting
migration to `platform/`. It stays at root for the same reason `languages/` and `tests/` do:

- **Not runtime source code.** These are Markdown protocol definitions consumed at prompt-construction
  time by LLM agents. They are never compiled by `tsc` or executed by Node.js.
- **Not adapter-specific.** They are referenced equally by all 4 adapters. Placing them under any
  single adapter or under `platform/` would misrepresent their cross-cutting nature.
- **Stability contract.** Changes require all-adapter verification. See `agents/knowledge/README.md`
  for ownership rules and the full protocol index.

## Protocol Neutrality

`platform/skills/` contains **protocol-neutral** canonical skill definitions:
- Define WHAT the skill does (phases, rules, constraints)
- NO adapter-specific tool names (not `Read`, not `read_file`, not `apply_diff`)
- NO adapter-specific paths (not adapter-specific env vars like `CLAUDE_PLUGIN_ROOT`)
- Use `quorum tool <name>` for generic tool invocation
- Use `{ADAPTER_ROOT}` as placeholder where adapter path is needed
- References use local relative paths (`references/xxx.md`)

All three adapters are **equal peers** — each creates its own wrapper with:
- Adapter-native tool mapping table
- Adapter-specific invocation paths
- Protocol references to `agents/knowledge/` and `platform/skills/*/references/`

## Neutrality Contract

Canonical skills (`platform/skills/**`) MUST NOT contain:

| Prohibited | Example | Use instead |
|------------|---------|-------------|
| Adapter-specific env vars | `${CLAUDE_PLUGIN_ROOT}`, `${GEMINI_EXTENSION_ROOT}`, `${CODEX_PLUGIN_ROOT}` | `${ADAPTER_ROOT}` (wrapper only) |
| Direct script paths | `node .../tool-runner.mjs` | `quorum tool <name>` |
| Adapter-specific tool names | `Read` vs `read_file` vs `apply_diff` | Generic operation names |
| Adapter directory references | `platform/adapters/claude-code/...` | Allowed only in meta files (ARCHITECTURE.md, doc-sync, skill-authoring) |

Enforced by: `node --test tests/skill-neutrality.test.mjs`

Frozen at zero violations by PLT-11C. Any new canonical skill that introduces adapter-specific
content will fail CI.

## Wrapper Template

Every adapter wrapper MUST follow this exact structure. **Maximum 35 lines.** Protocol duplication is prohibited -- all protocol content lives in canonical skills and `agents/knowledge/`.

### Required Structure

```markdown
---
name: quorum:{name}          # CC uses quorum:, Codex/Gemini/OAI use quorum-
description: "..."           # Preserved from original — do not abbreviate
[all other frontmatter]      # argument-hint, model, allowed-tools, context, etc.
---

# {Skill Title} ({Adapter Name})

Follow the canonical protocol at `platform/skills/{skill-name}/SKILL.md`.
[Optional: Core protocol reference, e.g. `agents/knowledge/{protocol}.md`.]
[Optional: References at `platform/skills/{skill-name}/references/`.]

## Tool Mapping

| Operation | Tool |
|-----------|------|
| Read file | `{native name}` |
| Write file | `{native name}` |
| ... | ... |

## Setup

{Adapter-specific config paths or invocation commands. Omit if nothing unique.}
```

### What Belongs Where

| Content | Location | NOT in wrapper |
|---------|----------|---------------|
| Protocol phases, rules, constraints | `platform/skills/{name}/SKILL.md` | Never duplicate |
| Business logic, checklists, gates | `agents/knowledge/*.md` | Never duplicate |
| Tool parameter details, examples | `platform/skills/{name}/references/` | Never duplicate |
| Tool name mapping (Read vs read_file) | **Wrapper** | -- |
| Adapter-specific paths, env vars | **Wrapper** | -- |
| Adapter-specific invocation commands | **Wrapper** | -- |
| Browser automation method (if different) | **Wrapper** | -- |

### Adapter Tool Name Reference

| Operation | Claude Code | Codex | Gemini | OpenAI-Compatible |
|-----------|-------------|-------|--------|-------------------|
| Read file | `Read` | `read_file` | `read_file` | `read` |
| Write file | `Write` | `write_file` | `write_file` | `write` |
| Edit file | `Edit` | `apply_diff` | `edit_file` | `edit` |
| Run command | `Bash` | `shell` | `shell` | `bash` |
| Find files | `Glob` | `find_files` | `glob` | `glob` |
| Search content | `Grep` | `search` | `grep` | `grep` |
| Spawn agent | `Agent` | `create_agent` | -- | -- |

### Size Budget

- Target: 20-30 lines
- Hard maximum: 35 lines (excluding frontmatter)
- If a wrapper exceeds 35 lines, protocol content has leaked into the wrapper

## Reference Resolution

References live in `platform/skills/{skill-name}/references/`. All adapters reference by project-root path:

```
platform/skills/{skill}/references/xxx.md
```

Consistent across all 3 adapters — no special cases.

## Adding a New Skill

1. Create `platform/skills/{name}/SKILL.md` with protocol-neutral content
2. Create `platform/skills/{name}/references/` if progressive disclosure needed
3. Create adapter wrappers (all 4) using the **Wrapper Template** above:
   - `platform/adapters/claude-code/skills/{name}/SKILL.md` (Read/Write/Edit/Bash/Glob/Grep)
   - `platform/adapters/codex/skills/{name}/SKILL.md` (read_file/write_file/apply_diff/shell/find_files/search)
   - `platform/adapters/gemini/skills/{name}/SKILL.md` (read_file/write_file/edit_file/shell/glob/grep)
   - `platform/adapters/openai-compatible/skills/{name}/SKILL.md` (read/write/edit/bash/glob/grep)
4. Verify each wrapper is under 35 lines (excluding frontmatter)
5. Update `CLAUDE.md` skill counts

## Adding a New Adapter

1. Create `platform/adapters/{name}/skills/` directory
2. For each shared skill, create adapter version with:
   - Adapter-native tool names (from `platform/adapters/shared/tool-names.mjs`)
   - Protocol references (`agents/knowledge/`)
   - Shared reference paths (`platform/skills/*/references/`)
3. Register tool names in `platform/adapters/shared/tool-names.mjs`
4. Create hooks in `platform/adapters/{name}/hooks/hooks.json`
