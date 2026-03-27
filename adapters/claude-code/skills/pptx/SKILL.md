---
name: quorum:pptx
description: "Create, read, edit, and process PowerPoint (.pptx) files. Includes design guidelines for professional presentations, template editing, and from-scratch creation with pptxgenjs. Use this skill whenever a .pptx file is involved — reading content, creating decks, editing slides, combining files, or working with templates and speaker notes. Triggers on 'pptx', 'PowerPoint', 'presentation', 'deck', 'slides', '프레젠테이션', '발표 자료', '슬라이드', 'PPT'."
argument-hint: "<operation: read|create|edit|template>"
model: claude-sonnet-4-6
allowed-tools: Read, Write, Bash(python *), Bash(node *), Bash(npm *), Bash(pip *)
---

# PPTX Processing (Claude Code)

## Tool Mapping

| Operation | Tool |
|-----------|------|
| Read file | `Read` |
| Write file | `Write` |
| Run command | `Bash` |

## Start

Read and follow the canonical skill at `skills/pptx/SKILL.md`.
Scripts are at `skills/pptx/scripts/`.
