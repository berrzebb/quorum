# Skill Architecture — v0.6.0 Knowledge-Centric Model

## Directory Structure

```
agents/knowledge/                ← Single source of truth for all knowledge
  ├── protocols/                 ← 25 procedural protocols
  ├── domains/                   ← 11 domain expertise files
  ├── tools/                     ← Tool catalog
  ├── references/                ← Progressive Disclosure material (77 files)
  └── scripts/                   ← Executable assets (63 files)

platform/skills/                 ← Core skill manifests (11 lightweight files)
  ├── {skill}/SKILL.md           ← Intent + knowledge refs (~15-30 lines)
  └── ARCHITECTURE.md            ← This file
```

## Design Principles

### 1. Knowledge Lives in One Place

All procedural knowledge, domain expertise, and reference material lives in `agents/knowledge/`.
Skills are **manifests** that reference knowledge, not containers that hold it.

```
Before (v0.5.0):  27 canonical SKILL.md (avg 130 lines) + 108 adapter wrappers = 135 files
After  (v0.6.0):  11 manifest SKILL.md (avg 20 lines) + 0 adapter wrappers = 11 files
                   Knowledge: agents/knowledge/ (178 files, one location)
```

### 2. Skills are Composition Recipes

A skill manifest defines:
- **name** — trigger identifier
- **description** — when to activate (aggressive, pushy)
- **model** — optimal model tier (haiku/sonnet/opus)
- **knowledge refs** — which protocols and references to load

A skill does NOT contain:
- Protocol steps (→ `agents/knowledge/protocols/`)
- Domain knowledge (→ `agents/knowledge/domains/`)
- Reference material (→ `agents/knowledge/references/`)
- Adapter-specific tool names (→ resolved at runtime via `tool-names.mjs`)

### 3. Adapter Resolution is Dynamic

No static adapter wrappers. Tool name mapping is resolved at runtime:

| Operation | Claude Code | Codex | Gemini | OpenAI-Compatible |
|-----------|-------------|-------|--------|-------------------|
| Read file | `Read` | `read_file` | `read_file` | `read` |
| Write file | `Write` | `write_file` | `write_file` | `write` |
| Edit file | `Edit` | `apply_diff` | `edit_file` | `edit` |
| Run command | `Bash` | `shell` | `shell` | `bash` |
| Find files | `Glob` | `find_files` | `glob` | `glob` |
| Search content | `Grep` | `search` | `grep` | `grep` |

Source: `platform/adapters/shared/tool-names.mjs`

### 4. On-Demand Skills via Harness

Skills not in the core 11 are generated on demand by `harness-bootstrap`:
1. Analyze requirement domain
2. Select protocols from `agents/knowledge/protocols/`
3. Select domain knowledge from `agents/knowledge/domains/`
4. Compose manifest + resolve adapter tools
5. Execute → audit → dispose

## Core Skills (11)

| Skill | Model | Knowledge Protocol |
|-------|-------|--------------------|
| planner | opus | `protocols/planner.md` |
| orchestrator | opus | `protocols/orchestrator.md` |
| audit | sonnet | `protocols/audit.md` |
| verify | haiku | `protocols/verify.md` |
| status | — | `protocols/status.md` |
| merge-worktree | sonnet | `protocols/merge-worktree.md` |
| harness-bootstrap | opus | `protocols/harness-bootstrap.md` |
| consensus-tools | — | `protocols/consensus-tools.md` |
| fde-analyst | opus | `protocols/fde-analyst.md` |
| wb-parser | haiku | `protocols/wb-parser.md` |
| designer | opus | `protocols/designer.md` |

## Adding Knowledge

New domain: add `agents/knowledge/domains/{domain}.md`. Harness discovers automatically.

New protocol: add `agents/knowledge/protocols/{name}.md`. Reference from manifests or harness.

New reference material: add to `agents/knowledge/references/{topic}/`.

## Protocol Rules

1. **Self-contained** — a protocol works without reading other protocols
2. **Audited changes** — protocol edits affect all generated skills; treat as code changes
3. **No adapter content** — protocols use `quorum tool <name>`, not adapter-native tool names
