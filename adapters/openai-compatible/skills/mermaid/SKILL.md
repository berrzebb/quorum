---
name: quorum-mermaid
description: "Generate mermaid diagrams from natural language descriptions or codebase analysis. Supports 13 diagram types (flowchart, sequence, class, state, ER, gantt, pie, radar, gitgraph, mindmap, timeline, architecture, block). Read the matching reference before generating. Use this skill whenever the user asks to visualize, diagram, chart, or draw anything — architecture, flows, schemas, timelines, relationships, hierarchies, or project schedules. Triggers on 'draw', 'diagram', 'mermaid', 'flowchart', 'sequence diagram', 'visualize', 'chart', '다이어그램', '시퀀스', '시각화', '구조도'."
argument-hint: "<diagram type or description>"
allowed-tools: read, write, glob, grep, bash
---

# Mermaid Diagram Generator (OpenAI-Compatible)

## Tool Mapping

| Operation | Tool |
|-----------|------|
| Read file | `read` |
| Write file | `write` |
| Find files | `glob` |
| Search content | `grep` |
| Run command | `bash` |

## Start

Read and follow the canonical skill at `platform/skills/mermaid/SKILL.md`.
Diagram syntax references are at `platform/skills/mermaid/references/{type}.md`.
