---
name: quorum:planner
description: "Design tasks into tracks with work breakdowns. Writes and maintains PRDs, generates DRM-driven documents. Triggers on 'add feature X', 'plan Z', 'write PRD', 'design tasks', '기능 추가', '설계'."
argument-hint: "<requirement or feature description>"
context: fork
model: claude-opus-4-6
allowed-tools: Read, Write, Grep, Glob, Bash(node *), Bash(cat *), Bash(ls *)
---

# Planner (Claude Code)

Follow the canonical protocol at `platform/skills/planner/SKILL.md`.
Reference documents are in `platform/skills/planner/references/`.

## Tool Mapping

| Operation | Tool |
|-----------|------|
| Read file | `Read` |
| Write file | `Write` |
| Find files | `Glob` |
| Search content | `Grep` |
| Run command | `Bash` |

## Setup

Config: `.quorum/config.json` — `consensus.planning_dirs`, `plugin.locale`.

## Deliverable Skills

When generating planning documents, use these skills for rich output:

| Skill | When to Use |
|-------|-------------|
| `/quorum:mermaid` | Architecture diagrams, sequence flows, ER schemas, state machines, timelines in any document |
| `/quorum:report` | Project completion reports with metrics, diagrams, and wireframes |
| `/pdf` | Final PRD/report export to PDF |
| `/ppt` | Presentation decks for stakeholder review |

**Mandatory visuals:**
- Every PRD must include at least one architecture diagram (mermaid flowchart or architecture-beta)
- Every Track README must include a dependency diagram
- **UI tracks must include SVG wireframes** for key screens — no UI work starts without wireframes
- Use `platform/skills/mermaid/references/` for syntax
