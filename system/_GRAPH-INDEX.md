# quorum Component Graph Index

> Component relationship hub. Open `system/` as an Obsidian vault and press `Ctrl+G` for graph view.

## Core Flow

```
Evidence ──▶ Trigger ──▶ Audit ──▶ Verdict ──▶ Retro ──▶ Commit
   │          (13-factor)  (T1/T2/T3)  (approve/reject)
   │                         │
   │                    ┌────┴────┐
   │                    │ T1 skip │ T2 simple │ T3 deliberative
   │                    └─────────┘
   │
   ▼
Fitness Gate ──▶ proceed / self-correct / auto-reject
```

## Agent → Protocol Connections

| Agent | Protocol | Domain |
|-------|----------|--------|
| [implementer](../adapters/claude-code/agents/implementer.md) | [implementer-protocol](../agents/knowledge/implementer-protocol.md) | — |
| [scout](../adapters/claude-code/agents/scout.md) | [scout-protocol](../agents/knowledge/scout-protocol.md) | — |
| [ui-reviewer](../adapters/claude-code/agents/ui-reviewer.md) | [ui-review-protocol](../agents/knowledge/ui-review-protocol.md) | — |
| [doc-sync](../adapters/claude-code/agents/doc-sync.md) | [doc-sync-protocol](../agents/knowledge/doc-sync-protocol.md) | docs |
| [perf-analyst](../adapters/claude-code/agents/perf-analyst.md) | [specialist-base](../agents/knowledge/specialist-base.md) | [perf](../agents/knowledge/domains/perf.md) |
| [a11y-auditor](../adapters/claude-code/agents/a11y-auditor.md) | [specialist-base](../agents/knowledge/specialist-base.md) | [a11y](../agents/knowledge/domains/a11y.md) |
| [compat-reviewer](../adapters/claude-code/agents/compat-reviewer.md) | [specialist-base](../agents/knowledge/specialist-base.md) | [compat](../agents/knowledge/domains/compat.md) |
| [compliance-officer](../adapters/claude-code/agents/compliance-officer.md) | [specialist-base](../agents/knowledge/specialist-base.md) | [compliance](../agents/knowledge/domains/compliance.md) |
| [concurrency-verifier](../adapters/claude-code/agents/concurrency-verifier.md) | [specialist-base](../agents/knowledge/specialist-base.md) | [concurrency](../agents/knowledge/domains/concurrency.md) |
| [doc-steward](../adapters/claude-code/agents/doc-steward.md) | [specialist-base](../agents/knowledge/specialist-base.md) | [docs](../agents/knowledge/domains/docs.md) |
| [i18n-checker](../adapters/claude-code/agents/i18n-checker.md) | [specialist-base](../agents/knowledge/specialist-base.md) | [i18n](../agents/knowledge/domains/i18n.md) |
| [infra-validator](../adapters/claude-code/agents/infra-validator.md) | [specialist-base](../agents/knowledge/specialist-base.md) | [infra](../agents/knowledge/domains/infra.md) |
| [observability-inspector](../adapters/claude-code/agents/observability-inspector.md) | [specialist-base](../agents/knowledge/specialist-base.md) | [observability](../agents/knowledge/domains/observability.md) |

## Skill → Agent Connections

| Skill | Connected Agent | Invocation |
|-------|-----------------|------------|
| [audit](../skills/audit/SKILL.md) | — | `/quorum:audit` |
| [implementer](../skills/implementer/SKILL.md) | implementer | Wave execution |
| [scout](../skills/scout/SKILL.md) | scout | `/quorum:cl-plan` |
| [orchestrator](../skills/orchestrator/SKILL.md) | implementer, scout | `/quorum:cl-orch` |
| [planner](../skills/planner/SKILL.md) | — | `/quorum:cl-plan` |
| [doc-sync](../skills/doc-sync/SKILL.md) | doc-sync | `/quorum:cl-docs` |
| [consensus-tools](../skills/consensus-tools/SKILL.md) | — | `/quorum:cl-tools` |
| [verify-implementation](../skills/verify-implementation/SKILL.md) | — | `/quorum:cl-verify` |
| [retrospect](../skills/retrospect/SKILL.md) | — | `/quorum:cl-retro` |
| [status](../skills/status/SKILL.md) | — | `/quorum:consensus-status` |
| [merge-worktree](../skills/merge-worktree/SKILL.md) | — | `/quorum:cl-merge` |
| [guide](../skills/guide/SKILL.md) | — | `/quorum:cl-guide` |

## Tool → Domain Connections

| MCP Tool | Domain | Agent |
|----------|--------|-------|
| [perf_scan](../skills/consensus-tools/references/perf-scan.md) | perf | perf-analyst |
| [a11y_scan](../skills/consensus-tools/references/a11y-scan.md) | a11y | a11y-auditor |
| [compat_check](../skills/consensus-tools/references/compat-check.md) | compat | compat-reviewer |
| [license_scan](../skills/consensus-tools/references/license-scan.md) | compliance | compliance-officer |
| [i18n_validate](../skills/consensus-tools/references/i18n-validate.md) | i18n | i18n-checker |
| [infra_scan](../skills/consensus-tools/references/infra-scan.md) | infra | infra-validator |
| [observability_check](../skills/consensus-tools/references/observability-check.md) | observability | observability-inspector |
| [doc_coverage](../skills/consensus-tools/references/doc-coverage.md) | docs | doc-steward |
| [code_map](../skills/consensus-tools/references/code-map.md) | — | — |
| [dependency_graph](../skills/consensus-tools/references/dependency-graph.md) | — | — |
| [blast_radius](../skills/consensus-tools/references/blast-radius.md) | — | — |
| [audit_scan](../skills/consensus-tools/references/audit-scan.md) | — | — |
| [coverage_map](../skills/consensus-tools/references/coverage-map.md) | — | — |
| [blueprint_lint](../skills/consensus-tools/references/) | — | — |
| [contract_drift](../skills/consensus-tools/references/) | — | — |

## Hook → Script Flow (Claude Code)

```
SessionStart ──▶ session-start.mjs (config copy, audit state, handoff)
       │
UserPromptSubmit ──▶ prompt-submit.mjs (retro enforcement, resume detection)
       │
PreToolUse [Bash|Agent] ──▶ session-gate.mjs (retro block, audit lock)
       │
   Tool Execution
       │
PostToolUse [Edit|Write] ──▶ index.mjs (trigger eval, domain routing, specialist tools)
       │
SubagentStart [implementer|scout] ──▶ subagent-start.mjs
SubagentStop [implementer] ──▶ subagent-stop.mjs
       │
TaskCompleted ──▶ task-completed.mjs (done-criteria verification)
       │
Stop ──▶ stop.mjs
```

## Adapter Parity

```
                    agents/knowledge/  (shared protocols)
                           │
                    skills/  (shared canonical)
                           │
              ┌────────────┼────────────┐────────────┐
              ▼            ▼            ▼            ▼
        claude-code     gemini       codex    openai-compatible
        21 hooks       11 hooks     6 hooks     (shared)
        16 skills      20 skills   20 skills    20 skills
        13 agents      (shared)    (shared)     13 agents
```

## Enforcement Gate Chain

```
Pre-audit:  Fitness Gate → Blast Radius → Trigger Eval
               │
Audit:      T1 (skip) │ T2 (solo) │ T3 (deliberative)
               │
Post-audit: Amendment Gate → Verdict Gate → Confluence Gate
               │
Design:     Design Gate → Blueprint Lint → Regression Gate
```

## Related Documents

- [Architecture Overview](README.md)
- [Agents Catalog](components/_agents-overview.md)
- [Skills Catalog](components/_skills-overview.md)
- [Hooks Catalog](components/_hooks-overview.md)
- [Tools Catalog](components/_tools-overview.md)
- [Domains Catalog](components/_domains-overview.md)
- [Audit Flow Scenario](scenarios/audit-flow.md)
