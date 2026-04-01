# Skills Overview

> 36 canonical skills defined in quorum (v0.5.0)
>
> **v0.3.0**: audit, implementer, scout, planner, status — core workflow
> **v0.4.0**: consensus-tools (26 MCP tool references), verify-implementation
> **v0.4.2**: orchestrator, retrospect, doc-sync, merge-worktree
> **v0.4.5**: commit-convention, guide, mcp-builder, skill-authoring, mermaid, pdf, pptx

## What are Skills?

Skills are **domain knowledge + workflow definitions** that Claude Code loads on demand.
- Auto-activate through keyword matching in `description` frontmatter
- Provide structured context (checklists, references, diagrams)
- Some invoke connected agents for independent task execution

## Skill Architecture

quorum uses a **3-layer inheritance model** (see `platform/skills/ARCHITECTURE.md`):

```
agents/knowledge/        ← protocols (business logic)
       │
platform/skills/*/SKILL.md    ← canonical definitions (protocol-neutral)
platform/skills/*/references/ ← progressive disclosure docs
       │
       ├── platform/adapters/claude-code/skills/   ← tool bindings
       ├── platform/adapters/gemini/skills/        ← tool bindings
       ├── platform/adapters/codex/skills/         ← tool bindings
       └── platform/adapters/openai-compatible/skills/
```

Protocol change → 1 file edit → all adapters reflect.

## Skill Classification

### Workflow Skills (10) — Process Automation

Skills that define how quorum operates. Value persists regardless of model capability.

| Skill | Purpose | Agent | Command |
|-------|---------|-------|---------|
| **audit** | Consensus protocol: evidence → trigger → audit | — | `/quorum:audit` |
| **orchestrator** | Wave execution: distribution, correction, lifecycle | implementer, scout | `/quorum:cl-orch` |
| **planner** | PRD → ADR → WB generation (MECE decomposition) | — | `/quorum:cl-plan` |
| **verify-implementation** | 8 done-criteria checks (CQ/T/CC/CL/S/I/FV/CV) | — | `/quorum:cl-verify` |
| **doc-sync** | 3-layer fact extraction + numeric mismatch fixing | doc-sync | `/quorum:cl-docs` |
| **retrospect** | Session learnings extraction, memory management | — | `/quorum:cl-retro` |
| **merge-worktree** | Git worktree merge + conflict resolution | — | `/quorum:cl-merge` |
| **commit-convention** | Commit message types, body guide, split patterns | — | — |
| **status** | Gate status, audit progress, agent assignments | — | `/quorum:consensus-status` |
| **guide** | Context-aware project onboarding | — | `/quorum:cl-guide` |

### Capability Skills (7) — Domain Expertise

Skills providing domain knowledge. Complement LLM reasoning with structured references.

| Skill | Purpose | References |
|-------|---------|------------|
| **consensus-tools** | 26 MCP tool catalog + usage examples | 21 reference files |
| **implementer** | Code implementation protocol | — |
| **scout** | RTM generation protocol | — |
| **ui-review** | UI verification checklist (UI-1~8) | — |
| **perf-analyst** | Performance analysis domain | — |
| **specialist-review** | Domain specialist orchestration | — |
| **skill-authoring** | Creating new skills following conventions | — |

### Utility Skills (8) — Document & Report Generation

Skills for producing artifacts beyond code.

| Skill | Purpose | References |
|-------|---------|------------|
| **mermaid** | Diagram generation (flowchart, sequence, ER, state, ...) | 16 reference files |
| **mcp-builder** | MCP server development patterns | 4 reference files |
| **pdf** | PDF manipulation and form handling | 2 reference files |
| **pptx** | PowerPoint creation and editing | 2 reference files |
| **docx** | DOCX document manipulation | 2 reference files |
| **html-report** | HTML report generation | 1 reference file |
| **report** | General report formatting | — |
| **docx-workspace** | DOCX workspace management | — |

## Progressive Disclosure

14 of 36 skills (39%) have `references/` subdirectories containing detailed documentation that loads only when needed:

| Skill | Reference Count | Topics |
|-------|-----------------|--------|
| consensus-tools | 21 | One file per MCP tool (parameters, examples, output format) |
| mermaid | 16 | One file per diagram type (flowchart, sequence, ER, ...) |
| planner | 13 | PRD, ADR, test strategy, UI spec, data model, WB, ... |
| orchestrator | 5 | correction, distribution, lifecycle, scout, tiers |
| mcp-builder | 4 | Server patterns, tool design, testing, deployment |
| commit-convention | 3 | types, body-guide, split-patterns |
| doc-sync | 3 | Layer definitions, fact extraction, mismatch rules |
| retrospect | 3 | candidates, execution, gathering |
| pdf | 2 | Manipulation patterns, form handling |
| pptx | 2 | Slide creation, template usage |
| docx | 2 | Document manipulation, styling |
| html-report | 1 | Report templates |
| verify-implementation | 1 | Check definitions |

**Total: 75+ reference documents** providing deep knowledge on demand.

## Skill Frontmatter Structure

```yaml
---
name: skill-name
description: |
  Skill description.
  Triggers: keyword1, keyword2
  Do NOT use for: exclusion conditions
allowed-tools:
  - Read
  - Grep
  - Glob
  - mcp__quorum__tool_name
---
```

## Adapter Skill Counts

| Adapter | Skill Count | Notes |
|---------|-------------|-------|
| Canonical (`platform/skills/`) | 25 | Protocol-neutral definitions |
| Claude Code | 16 | Subset with CC-specific tool bindings |
| Gemini | 20 | Gemini CLI tool bindings |
| Codex | 20 | Codex tool bindings |
| OpenAI-compatible | 20 | OpenAI-format tool bindings |

## Skill Source Location

```
quorum/
├── platform/skills/                 ← canonical (25 directories)
│   ├── ARCHITECTURE.md              ← inheritance model documentation
│   ├── audit/SKILL.md
│   ├── planner/
│   │   ├── SKILL.md
│   │   └── references/              ← 13 reference files
│   ├── consensus-tools/
│   │   ├── SKILL.md
│   │   └── references/              ← 21 reference files
│   └── ...
├── platform/adapters/claude-code/skills/     ← CC wrappers (16 SKILL.md)
├── platform/adapters/gemini/skills/          ← Gemini wrappers (20 SKILL.md)
├── platform/adapters/codex/skills/           ← Codex wrappers (20 SKILL.md)
└── platform/adapters/openai-compatible/skills/ ← OAI wrappers (20 SKILL.md)
```

## Related Documents

- [Agents Overview](_agents-overview.md) — agent ↔ skill connections
- [Tools Overview](_tools-overview.md) — MCP tools referenced by skills
- [Graph Index](../_GRAPH-INDEX.md) — skill → agent → tool relationship map
