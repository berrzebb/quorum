---
name: quorum-convergence-loop
description: "Evaluator-Optimizer loop adapted to quorum's parliamentary system. Iterates evaluate→fix→re-evaluate until fitness + confluence + amendment criteria converge. Max 5 iterations with stagnation detection. Single responsibility: convergence orchestration. Triggers on 'iterate', 'converge', 'auto-fix loop', '수렴', '반복 개선', '자동 수정', 'iterate until passing'."
argument-hint: "<track name> [--max-iterations N] [--threshold N]"
model: gemini-2.5-pro
allowed-tools: read_file, write_file, glob, grep, run_shell_command, spawn_agent
---

# Convergence Loop (Gemini)

## Gemini Tool Mapping

| Operation | Tool |
|-----------|------|
| Read file | `read_file` |
| Write file | `write_file` |
| Find files | `glob` |
| Search content | `grep` |
| Run command | `run_shell_command` |
| Spawn evaluator | `spawn_agent` |

## Start

Read and follow the canonical skill at `skills/convergence-loop/SKILL.md`.
