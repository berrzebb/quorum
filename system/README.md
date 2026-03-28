# quorum System Architecture

> Cross-model audit gate with structural enforcement. v0.4.5
>
> **v0.3.0**: Parliament protocol, 3-role deliberative consensus
> **v0.4.0**: SQLite unified state, fitness score engine, 22 MCP tools
> **v0.4.2**: Confluence verification, amendment protocol, Normal Form convergence
> **v0.4.5**: Wave execution, Fixer role, 4-adapter parity, 1077 tests
> **v0.4.6**: Quality gate chain (21-gate), fitness integration, cross-model audit

## Overview

quorum is a cross-model audit gate plugin for AI coding assistants.
One model writes code, an independent auditor reviews it, the cycle repeats until consensus.
The system makes mistakes **structurally hard** — not through better prompts, but through governance.

```
┌─────────────────────────────────────────────────────────────┐
│                    quorum Architecture                      │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐   │
│  │   Evidence    │──▶│   Trigger    │──▶│    Audit     │   │
│  │  (code edit)  │   │  (13-factor) │   │  (consensus) │   │
│  └──────────────┘   └──────────────┘   └──────────────┘   │
│         │                                      │           │
│         │           ┌──────────────┐           │           │
│         │           │   Verdict    │◀──────────┘           │
│         │           │  (approve/   │                       │
│         │           │   reject)    │                       │
│         │           └──────────────┘                       │
│         │                  │                               │
│         ▼                  ▼                               │
│  ┌──────────────┐   ┌──────────────┐                      │
│  │   Fitness    │   │   Retro      │                      │
│  │  (7-metric)  │   │  (learnings) │                      │
│  └──────────────┘   └──────────────┘                      │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐  │
│  │           Structural Enforcement Layer               │  │
│  │  Normal Form │ Confluence │ Amendment │ Parliament   │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## Component Counts

| Component | Count | Location |
|-----------|-------|----------|
| **Agents** | 13 | `adapters/claude-code/agents/` |
| **Skills** | 25 canonical | `platform/skills/*/SKILL.md` |
| **Hook Events** | 26 unique | `adapters/*/hooks/hooks.json` |
| **MCP Tools** | 22 deterministic | `core/tools/mcp-server.mjs` (data, not yet moved) |
| **Domain Specialists** | 11 | `agents/knowledge/domains/` |
| **Event Types** | 58 | `platform/bus/events.ts` (`bus/events.ts` facade) |
| **Adapters** | 4 | Claude Code, Gemini CLI, Codex, OpenAI-compatible |
| **Test Cases** | ~1,419 | `tests/*.test.mjs` (57 files) |
| **Protocols** | 6 | `agents/knowledge/*.md` |

## Core Principles

1. **No single model can both write and approve code** — structural separation of writer and auditor
2. **Measurable things are never asked to the LLM** — fitness score gates before audit
3. **Deterministic tools establish facts first** — 22 MCP tools run before LLM reasoning
4. **Structure → Consensus → Convergence** — Normal Form is the destination

→ See [philosophy/](philosophy/) for detailed design rationale.

## Layer Architecture

All runtime modules consolidated under `platform/`. Root directories are re-export facades.

```
┌─ I/O Layer ──────────────────────────────────────────────┐
│  adapters/claude-code/  adapters/gemini/  adapters/codex/ │
│  (hooks, skills, agents — adapter-specific tool bindings) │
└──────────────────────────────────────────────────────────┘
         │                    │                    │
         ▼                    ▼                    ▼
┌─ Business Logic Layer ───────────────────────────────────┐
│  platform/adapters/shared/  (17 modules)                 │
│  hook-runner, trigger-runner, audit-state, cli-adapter    │
└──────────────────────────────────────────────────────────┘
         │
         ▼
┌─ Core Layer ─────────────────────────────────────────────┐
│  platform/core/bridge.mjs → platform/bus/ → platform/providers/ │
│  (MJS↔TS bridge)            (SQLite)        (consensus)         │
└──────────────────────────────────────────────────────────┘
         │
         ▼
┌─ Knowledge Layer ────────────────────────────────────────┐
│  agents/knowledge/  (protocols + 11 domains)             │
│  skills/  (25 canonical definitions + 75+ references)    │
│  languages/  (5 language specs + fragments)              │
└──────────────────────────────────────────────────────────┘
```

## Source File Map

Source modules are consolidated under `platform/`. Root-level directories are thin re-export facades for backward compatibility.

| Component | Canonical Path | Root Facade |
|-----------|---------------|-------------|
| CLI dispatcher | `platform/cli/` | `cli/` |
| CLI commands | `platform/cli/commands/` | `cli/commands/` |
| Event Bus | `platform/bus/events.ts` | `bus/events.ts` |
| SQLite Store | `platform/bus/store.ts` | `bus/store.ts` |
| Bridge | `platform/core/bridge.mjs` | `core/bridge.mjs` |
| Context | `platform/core/context.mjs` | `core/context.mjs` |
| Orchestration | `platform/orchestrate/` | `orchestrate/` |
| Providers | `platform/providers/` | `providers/` |
| Adapters (shared) | `platform/adapters/shared/` | _(facades removed)_ |

Data files and non-consolidated modules remain at root:

| Component | Path |
|-----------|------|
| Skills (canonical) | `platform/skills/*/SKILL.md` |
| Skills (references) | `platform/skills/*/references/*.md` |
| Agents (Claude Code) | `adapters/claude-code/agents/*.md` |
| Agent Protocols | `agents/knowledge/*.md` |
| Domain Knowledge | `agents/knowledge/domains/*.md` |
| Hooks (Claude Code) | `adapters/claude-code/hooks/hooks.json` |
| Hooks (Gemini) | `adapters/gemini/hooks/hooks.json` |
| Hooks (Codex) | `adapters/codex/hooks/hooks.json` |
| MCP Tools | `core/tools/*.mjs` |
| MCP Server | `core/tools/mcp-server.mjs` |
| Templates | `core/templates/` |
| Locales | `core/locales/` |
| Language Specs | `languages/*/spec.mjs` |
| TUI Dashboard | `daemon/` |
| Public Docs | `docs/`, `docs/ko-KR/` |

## Documentation Entry Points

| Audience | Start Here |
|----------|------------|
| New user | `README.md` → `docs/README.md` |
| New contributor | `CLAUDE.md` → `agents/knowledge/` protocols |
| Skill author | `platform/skills/ARCHITECTURE.md` → `platform/skills/skill-authoring/SKILL.md` |
| Tool user | `docs/TOOLS.md` or `platform/skills/consensus-tools/references/` |
| Adapter author | `platform/adapters/shared/` → adapter `hooks/hooks.json` |

## Related Documents

- [Component Graph Index](_GRAPH-INDEX.md)
- [Design Philosophy](philosophy/)
- [Component Catalogs](components/)
- [Workflow Scenarios](scenarios/)
