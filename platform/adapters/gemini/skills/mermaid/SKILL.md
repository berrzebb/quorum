---
name: quorum-mermaid
description: "Generate mermaid diagrams from natural language descriptions or codebase analysis. Supports 13 diagram types (flowchart, sequence, class, state, ER, gantt, pie, radar, gitgraph, mindmap, timeline, architecture, block). Read the matching reference before generating. Use this skill whenever the user asks to visualize, diagram, chart, or draw anything — architecture, flows, schemas, timelines, relationships, hierarchies, or project schedules. Triggers on 'draw', 'diagram', 'mermaid', 'flowchart', 'sequence diagram', 'visualize', 'chart', '다이어그램', '시퀀스', '시각화', '구조도'."
argument-hint: "<diagram type or description>"
model: gemini-2.5-pro
allowed-tools: read_file, write_file, glob, grep, run_shell_command
---

# Mermaid Diagram Generator (Gemini)

## Tool Mapping

| Operation | Tool |
|-----------|------|
| Read file | `read_file` |
| Write file | `write_file` |
| Find files | `glob` |
| Search content | `grep` |
| Run command | `run_shell_command` |

## Start

Read and follow the canonical skill at `platform/skills/mermaid/SKILL.md`.
Diagram syntax references are at `platform/skills/mermaid/references/{type}.md`.
