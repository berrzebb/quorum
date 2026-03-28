---
name: quorum-convergence-loop
description: "Evaluator-Optimizer loop adapted to quorum's parliamentary system. Iterates evaluate→fix→re-evaluate until fitness + confluence + amendment criteria converge. Max 5 iterations with stagnation detection. Single responsibility: convergence orchestration. Triggers on 'iterate', 'converge', 'auto-fix loop', '수렴', '반복 개선', '자동 수정', 'iterate until passing'."
argument-hint: "<track name> [--max-iterations N] [--threshold N]"
allowed-tools: read, write, glob, grep, bash, agent
---

# Convergence Loop (OpenAI-Compatible)

## Tool Mapping

| Operation | Tool |
|-----------|------|
| Read file | `read` |
| Write file | `write` |
| Find files | `glob` |
| Search content | `grep` |
| Run command | `bash` |
| Spawn evaluator | `agent` |

## Start

Read and follow the canonical skill at `platform/skills/convergence-loop/SKILL.md`.
