---
name: quorum-pptx
description: "Create, read, edit, and process PowerPoint (.pptx) files. Includes design guidelines for professional presentations, template editing, and from-scratch creation with pptxgenjs. Use this skill whenever a .pptx file is involved — reading content, creating decks, editing slides, combining files, or working with templates and speaker notes. Triggers on 'pptx', 'PowerPoint', 'presentation', 'deck', 'slides', '프레젠테이션', '발표 자료', '슬라이드', 'PPT'."
argument-hint: "<operation: read|create|edit|template>"
model: gemini-2.5-pro
allowed-tools: read_file, write_file, run_shell_command
---

# PPTX Processing (Gemini)

## Tool Mapping

| Operation | Tool |
|-----------|------|
| Read file | `read_file` |
| Write file | `write_file` |
| Run command | `run_shell_command` |

## Start

Read and follow the canonical skill at `platform/skills/pptx/SKILL.md`.
Scripts are at `platform/skills/pptx/scripts/`.
