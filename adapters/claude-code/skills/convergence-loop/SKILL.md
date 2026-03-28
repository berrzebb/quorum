---
name: quorum:convergence-loop
description: "Evaluator-Optimizer loop adapted to quorum's parliamentary system. Iterates evaluate→fix→re-evaluate until fitness + confluence + amendment criteria converge. Max 5 iterations with stagnation detection. Single responsibility: convergence orchestration. Triggers on 'iterate', 'converge', 'auto-fix loop', '수렴', '반복 개선', '자동 수정', 'iterate until passing'."
argument-hint: "<track name> [--max-iterations N] [--threshold N]"
model: claude-sonnet-4-6
allowed-tools: Read, Write, Glob, Grep, Bash(node *), Bash(quorum *), Agent
---

# Convergence Loop (Claude Code)

## Claude Code Tool Mapping

| Operation | Tool |
|-----------|------|
| Read file | `Read` |
| Write file | `Write` |
| Find files | `Glob` |
| Search content | `Grep` |
| Run command | `Bash` |
| Spawn evaluator | `Agent` |

## Start

Read and follow the canonical skill at `platform/skills/convergence-loop/SKILL.md`.
