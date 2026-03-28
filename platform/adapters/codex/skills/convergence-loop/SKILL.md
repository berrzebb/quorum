---
name: quorum-convergence-loop
description: "Evaluator-Optimizer loop adapted to quorum's parliamentary system. Iterates evaluate→fix→re-evaluate until fitness + confluence + amendment criteria converge. Max 5 iterations with stagnation detection. Single responsibility: convergence orchestration. Triggers on 'iterate', 'converge', 'auto-fix loop', '수렴', '반복 개선', '자동 수정', 'iterate until passing'."
argument-hint: "<track name> [--max-iterations N] [--threshold N]"
model: codex
allowed-tools: read_file, write_file, find_files, search, shell, create_agent
---

# Convergence Loop (Codex)

## Codex Tool Mapping

| Operation | Tool |
|-----------|------|
| Read file | `read_file` |
| Write file | `write_file` |
| Find files | `find_files` |
| Search content | `search` |
| Run command | `shell` |
| Spawn evaluator | `create_agent` |

## Start

Read and follow the canonical skill at `platform/skills/convergence-loop/SKILL.md`.
