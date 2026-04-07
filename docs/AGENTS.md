# quorum AI Agent Guide

> For AI agents working in projects with quorum installed.

## Role Chain

| Role | Responsibility | Model | Turns |
|------|---------------|-------|-------|
| **planner** | Track definition + execution plan | Opus | 30 |
| **wb-parser** | Parse WB files → requirements table | Haiku | — |
| **rtm-scanner** | Scan code → Forward/Backward RTM rows | Haiku | — |
| **scout** | Analyze RTM gaps + cross-track issues (Phase 5-8) | Sonnet | 30 |
| **designer** | Design docs (Spec, Blueprint, Domain Model, Architecture) | Sonnet | — |
| **fde-analyst** | Failure mode checklists per requirement | Haiku | — |
| **orchestrator** | Distribute → track → gate chain → merge | main session | — |
| **implementer** | Implement in worktree + test + submit evidence | Sonnet | 30 |
| **self-checker** | Deterministic CQ/T/lint/scope checks (post-implementation) | Haiku | 15 |
| **fixer** | Targeted fixes from audit rejection (no rewrite) | Sonnet | 15 |
| **gap-detector** | Cross-track gap analysis from RTM | Haiku | — |
| **specialist** | Domain review (perf, a11y, security, ...) — confidence ≥ 0.8 | per-domain | 15 |
| **auditor** | Independent verification → approve/reject | GPT/Codex | — |

## Role Dispatch Pipeline

```
Phase 1-4: planner (Opus)
  └→ wb-parser (Haiku) → requirements table
  └→ designer (Sonnet) → design docs
  └→ fde-analyst (Haiku) → failure checklists

Phase 5-8: RTM + analysis
  └→ rtm-scanner (Haiku) → Forward/Backward RTM rows
  └→ scout (Sonnet) → gap analysis + cross-track report

Phase N: Wave execution (per WB)
  └→ implementer (Sonnet) → code + test + evidence
  └→ self-checker (Haiku) → CQ/T/lint/scope (deterministic only)
       ├→ PASS → 21-gate chain → audit
       └→ FAIL → fixer (Sonnet) → re-check
  └→ auditor → verdict
       ├→ approved → confluence check → retro → merge
       └→ changes_requested → fixer (Sonnet) → re-audit
```

## Full Cycle

```
planner → design → RTM generation → orchestrator → distribute
    ↓
┌─── Track A (worktree) ──────────────────────────────────────┐
│  implementer: code + test + evidence                         │
│  → self-checker (haiku): CQ/T/lint/scope — deterministic     │
│       FAIL → fixer (sonnet): targeted fix → re-check         │
│  → 21-gate chain (mechanical)                                │
│  → audit (trigger eval: T1 skip / T2 simple / T3 deliberative)│
│       T3: Advocate + Devil's Advocate → Judge                 │
│  → verdict                                                   │
│       changes_requested → fixer → re-audit (max 3 rounds)    │
│       approved → confluence check → project tests             │
│  → retrospective (session-gate blocks Bash/Agent)             │
│  → merge → squash → single commit → next track                │
└──────────────────────────────────────────────────────────────┘
```

## 21-Gate Chain (Pre-Audit)

Mechanical gates — all run before audit. No LLM involved.

| # | Gate | Blocking | Description |
|---|------|----------|-------------|
| 1 | Regression Detection | warn | >50% file content replacement |
| 2 | Stub/Placeholder Scan | warn | `TODO`, `FIXME`, empty implementations |
| 3 | Blueprint Naming Lint | **block** | Naming conventions are law |
| 4 | Perf Anti-Patterns | warn | O(n²) loops, sync I/O, unbounded queries |
| 5 | Dependency Audit | **block** | Copyleft license detection |
| 6 | File Scope Enforcement | warn | Changed files outside targetFiles |
| 7 | Fitness Gate | **block** | Score drop >0.15 → auto-reject |
| 8 | Test File Creation | warn | WB.verify = test but no test file |
| 9 | WB Constraints | warn | Cross-WB dependency validation |
| 10-21 | Domain Scans | varies | perf, a11y, security, compat, ... |

## Parliamentary Checkpoints

5 decision gates during orchestration. Tier determines which are active:

| # | Checkpoint | When | Tier 1 | Tier 2 | Tier 3 |
|---|-----------|------|--------|--------|--------|
| 1 | Requirement Confirmation | after planner | skip | skip | active |
| 2 | Design Choice | after designer | skip | active | active |
| 3 | Implementation Scope | before wave | skip | skip | active |
| 4 | Quality Verdict | after audit | skip | active | active |
| 5 | Convergence Decision | after retro | skip | skip | active |

## Amendment Voting

Tiered thresholds by amendment target:

| Target | Threshold | Rationale |
|--------|-----------|-----------|
| WB (Work Breakdown) | 50% simple majority | Tactical change |
| PRD (Requirements) | 66% super-majority | Changes what we're building |
| Design | 66% super-majority | Changes how we're building |
| Scope | 100% unanimous | Changes project boundary |

## Specialist Confidence Filtering

Specialist reviewers use confidence-based filtering:

| Confidence | Action |
|-----------|--------|
| 0.9–1.0 | Report (certain bugs, violations) |
| 0.8–0.89 | Report (very likely issues) |
| 0.5–0.79 | **DO NOT report** (advisory only) |
| < 0.5 | Skip |

Max 10 findings per review, highest severity × confidence prioritized.

## Evidence Package Format

Submit evidence via `audit_submit` tool:

```markdown
## [trigger_tag] Task Title

### Claim
What you did.

### Changed Files
- `src/path/file.ts` — description

### Test Command
\`\`\`bash
npx vitest run tests/file.test.ts
\`\`\`

### Test Result
\`\`\`
Paste actual terminal output verbatim.
\`\`\`

### Blast Radius (optional)
file → N direct, M transitive (ratio%)

### Residual Risk
Known unresolved items or "None".
```

## Absolute Rules

1. Only use `[trigger_tag]` — never non-standard labels.
2. No self-promotion — only the auditor applies `[agree_tag]`.
3. Test commands must be re-runnable verbatim.
4. Changed Files must match the actual diff.

## Planner Documents

The planner generates 8 documents per track across 3 parallel sub-agents (v0.6.5):

| # | Document | Agent (Phase) | Responsibility |
|---|----------|---------------|---------------|
| 1 | **PRD** | planner-prd (1) | WHAT/WHY — problem, goals, non-goals, risks |
| 2 | **Spec** | planner-prd (1) | Interfaces — API endpoints, DDL, env vars, error codes |
| 3 | **Blueprint** | planner-prd (1) | Structure — directory tree, naming conventions (= law) |
| 4 | **Domain Model** | planner-prd (1) | Entities — ER diagram, state machines, invariants |
| 5 | **Work Breakdown** | planner-wb (2a) | HOW TO BUILD — per-task Action/Verify/Done |
| 6 | **Execution Order** | planner-support (2b) | WHEN — phase dependency graph, critical path |
| 7 | **Test Strategy** | planner-support (2b) | HOW TO VERIFY — test types, fixtures, coverage targets |
| 8 | **Work Catalog** | planner-support (2b) | STATUS — summary table: ID, title, size, phase, status |

**Separation principle**: each document has a single responsibility.

**2-phase execution**: Phase 1 (design docs) must complete before Phase 2 (WB + support). WB gets a dedicated agent to prevent context overload.

## Session Gate

After audit approval, `session-gate.mjs` blocks Bash/Agent until retrospective completes:

- **Blocked**: Bash, Agent, git
- **Allowed**: Read, Write, Edit, Glob, Grep
- **Release**: `echo session-self-improvement-complete`
