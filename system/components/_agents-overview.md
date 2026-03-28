# Agents Overview

> 13 agents defined in quorum (v0.4.5)
>
> **v0.3.0**: implementer, scout — core execution agents
> **v0.4.0**: 11 domain specialists added (perf, a11y, security, ...)
> **v0.4.2**: doc-sync agent for 3-layer documentation synchronization
> **v0.4.5**: 4-adapter parity — all agents shared across Claude Code, Gemini, Codex, OpenAI-compatible

## What are Agents?

Agents are **AI sub-agents specialized for specific domains**.
- Spawned via Task/Agent tool to perform independent work
- Each follows a shared protocol from `agents/knowledge/`
- Domain specialists use deterministic MCP tools before LLM reasoning

## Agent Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Agent Architecture                       │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌──────────────────────┐   ┌──────────────────────┐       │
│  │  Protocol Layer      │   │  Domain Knowledge    │       │
│  │  (agents/knowledge/) │   │  (agents/knowledge/  │       │
│  │                      │   │   domains/)          │       │
│  │  • implementer       │   │                      │       │
│  │  • scout             │   │  • perf, a11y, ...   │       │
│  │  • specialist-base   │   │  • 11 domains        │       │
│  │  • ui-review         │   │                      │       │
│  │  • doc-sync          │   │                      │       │
│  │  • tool-inventory    │   │                      │       │
│  └──────────────────────┘   └──────────────────────┘       │
│              │                          │                   │
│              ▼                          ▼                   │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Adapter Agents (tool bindings only)                 │  │
│  │  platform/adapters/claude-code/agents/*.md            │  │
│  │  platform/adapters/openai-compatible/agents/*.md     │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## Full Agent List

### Core Execution Agents (3)

| Agent | Protocol | Role | Trigger |
|-------|----------|------|---------|
| **implementer** | implementer-protocol | Wave-based code implementation, self-correcting loops | `quorum orchestrate run` |
| **scout** | scout-protocol | RTM generation, requirement tracing (read-only) | `/quorum:cl-plan`, orchestrator |
| **ui-reviewer** | ui-review-protocol | UI component verification (state, a11y, interactions) | specialist routing |

### Documentation Agent (1)

| Agent | Protocol | Role | Trigger |
|-------|----------|------|---------|
| **doc-sync** | doc-sync-protocol | 3-layer fact extraction, numeric mismatch fixing | `/quorum:cl-docs`, merge Phase 2.5 |

### Domain Specialist Agents (9)

All domain specialists follow `specialist-base` protocol: tools first → facts constrain inference → high-confidence findings only.

| Agent | Domain | MCP Tool | Pattern Focus |
|-------|--------|----------|---------------|
| **perf-analyst** | Performance | `perf_scan` | N+1 queries, O(n²) loops, sync I/O, unbounded iteration |
| **a11y-auditor** | Accessibility | `a11y_scan` | Missing labels, keyboard traps, ARIA violations |
| **compat-reviewer** | Compatibility | `compat_check` | API deprecation, CJS/ESM mixing, version constraints |
| **compliance-officer** | Compliance | `license_scan` | Copyleft contamination, PII patterns, legal risks |
| **concurrency-verifier** | Concurrency | — | Race conditions, deadlocks, thread safety |
| **doc-steward** | Documentation | `doc_coverage` | JSDoc gaps, docstring parity, API documentation |
| **i18n-checker** | Internationalization | `i18n_validate` | Hardcoded strings, locale key mismatches, Unicode |
| **infra-validator** | Infrastructure | `infra_scan` | Docker security, CI config, container policy |
| **observability-inspector** | Observability | `observability_check` | Empty catch blocks, missing logs, console.log in prod |

## Agent Activation

### Domain Detection (Zero-Cost)

Agents are activated through file pattern matching — no LLM call needed:

```
Changed file: src/api/users.ts
  → Detected domains: perf (API endpoint), security (auth patterns)
  → Activated agents: perf-analyst, (security specialist via audit)
```

### Tier-Based Routing

| Tier | Specialist Action |
|------|-------------------|
| T1 (skip) | No specialist activation |
| T2 (solo) | Deterministic tools only (MCP scan results in evidence) |
| T3 (deliberative) | Full specialist agent spawned with LLM reasoning |

## Protocol Inheritance

```
agents/knowledge/specialist-base.md      ← base protocol (all 9 specialists)
agents/knowledge/domains/{domain}.md     ← domain patterns + rules
platform/adapters/claude-code/agents/{name}.md    ← tool bindings (Read, Grep, MCP tools)
```

Changing `specialist-base.md` affects all 9 specialists across all 4 adapters.
Changing a domain file (e.g., `perf.md`) affects only that domain's specialist.

## Agent Source Location

```
quorum/
├── agents/knowledge/               ← shared protocols (6 files)
│   ├── implementer-protocol.md
│   ├── scout-protocol.md
│   ├── specialist-base.md
│   ├── ui-review-protocol.md
│   ├── doc-sync-protocol.md
│   ├── tool-inventory.md
│   └── domains/                    ← domain knowledge (11 files)
│       ├── perf.md
│       ├── a11y.md
│       └── ...
├── platform/adapters/claude-code/agents/    ← Claude Code bindings (13 files)
└── platform/adapters/openai-compatible/agents/ ← OpenAI bindings (13 files)
```

## Related Documents

- [Skills Overview](_skills-overview.md) — skill ↔ agent connections
- [Tools Overview](_tools-overview.md) — MCP tools used by specialists
- [Domains Overview](_domains-overview.md) — 11 domain knowledge files
- [Graph Index](../_GRAPH-INDEX.md) — full relationship map
