# quorum AI Agent Guide

> For AI agents working in projects with quorum installed.

## Role Chain

| Role | Responsibility | Model |
|------|---------------|-------|
| **planner** | Track definition + execution plan | Opus |
| **scout** | Read-only RTM generation (3-way traceability) | Opus |
| **orchestrator** | Distribute → track → correct → merge | main session |
| **implementer** | Implement in worktree + test + submit evidence | Sonnet |
| **auditor** | Independent verification → approve/reject | GPT/Codex |

## Full Cycle

```
planner → RTM generation → orchestrator → scout → distribute
    ↓
┌─── Track A (worktree) ──────┐  ┌─── Track B (worktree) ──────┐
│  implementer: code + test    │  │  implementer: code + test    │
│  → verify (CQ/T/CC/CL/S)    │  │  → verify                    │
│  → submit evidence           │  │  → submit evidence           │
│  → audit (trigger eval)      │  │  → audit                     │
│    T1: skip                  │  │    T3: deliberative           │
│    T2: simple                │  │    Advocate+Devil→Judge       │
│  → verdict                   │  │  → verdict                   │
└──────────────────────────────┘  └──────────────────────────────┘
    ↓
Retrospective (session-gate blocks Bash/Agent)
    → echo session-self-improvement-complete → gate release
    ↓
Merge → squash → single commit → next track
```

## Trigger Evaluation

Before each audit, a 13-factor score (12 base + interaction multipliers) determines the consensus mode:

| Factor | Weight | Description |
|--------|--------|-------------|
| Changed files | 0–0.3 | 1-2 files = low, 8+ = high |
| Security sensitive | 0–0.25 | auth/token/secret patterns |
| Prior rejections | 0–0.2 | Repeated failures escalate |
| API surface | 0–0.15 | Public interface changes |
| Cross-layer | 0–0.1 | BE + FE changes together |
| Revert | -0.3 | Rollbacks reduce risk |
| Domain signals | 0–0.1 | Specialist domain detected |
| Plan document | 0–0.1 | Structured plan exists |
| Fitness score | 0–0.1 | Quality metric from FitnessLoop |
| Blast radius | 0–0.15 | Transitive impact ratio > 10% |

Score → tier: < 0.3 = T1 skip, 0.3–0.7 = T2 simple, > 0.7 = T3 deliberative.

## Evidence Package Format

Submit evidence via `audit_submit` tool:

```markdown
## [trigger_tag] Task Title

### Claim
What you did.

### Changed Files
- `src/path/file.ts` — description

### Test Command
```bash
npx vitest run tests/file.test.ts
```

### Test Result
```
Paste actual terminal output verbatim.
```

### Residual Risk
Known unresolved items or "None".
```

## Absolute Rules

1. Only use `[trigger_tag]` — never non-standard labels.
2. No self-promotion — only the auditor applies `[agree_tag]`.
3. Test commands must be re-runnable verbatim.
4. Changed Files must match the actual diff.

## Planner Documents

The planner skill produces 10 document types. Each has a fixed location and a reference guide.

| Document | Level | Location | Purpose |
|----------|-------|----------|---------|
| **PRD** | Project | `{planning_dir}/PRD.md` | Product requirements — problem, goals, features, acceptance criteria |
| **Execution Order** | Project | `{planning_dir}/execution-order.md` | Track dependency graph — which tracks to execute first |
| **Work Catalog** | Project | `{planning_dir}/work-catalog.md` | All tasks across all tracks with status and priority |
| **ADR** | Project | `{planning_dir}/adr/ADR-{NNN}.md` | Architecture Decision Records — why, not just what |
| **Track README** | Track | `{planning_dir}/{track}/README.md` | Track scope, goals, success criteria, constraints |
| **Work Breakdown** | Track | `{planning_dir}/{track}/work-breakdown.md` | Task decomposition — `### [task-id]` blocks with depends_on/blocks |
| **API Contract** | Track | `{planning_dir}/{track}/api-contract.md` | Endpoint specs, request/response schemas, auth requirements |
| **Test Strategy** | Track | `{planning_dir}/{track}/test-strategy.md` | Test plan — unit/integration/e2e scope, coverage targets |
| **UI Spec** | Track | `{planning_dir}/{track}/ui-spec.md` | Component hierarchy, states (loading/error/empty/success), interactions |
| **Data Model** | Track | `{planning_dir}/{track}/data-model.md` | Entity relationships, schemas, migrations, indexes |

Reference guides for each document type are at `${CLAUDE_PLUGIN_ROOT}/skills/planner/references/`.

## Deterministic Tools (MCP)

Use deterministic tools before LLM reasoning:

| Tool | Purpose |
|------|---------|
| `code_map` | Symbol index (functions, classes, types) |
| `dependency_graph` | Import DAG, topological sort, cycles |
| `audit_scan` | Pattern scan (type-safety, hardcoded) |
| `coverage_map` | Per-file coverage from vitest JSON |
| `rtm_parse` | Parse RTM markdown → structured rows |
| `rtm_merge` | Row-level merge with conflict detection |
| `audit_history` | Query audit verdicts and patterns |
| `perf_scan` | Performance anti-patterns (O(n²), sync I/O, busy loops) |
| `a11y_scan` | Accessibility (missing alt, non-keyboard onClick, aria) |
| `compat_check` | Compatibility (@deprecated, @breaking, CJS/ESM) |
| `license_scan` | License + PII (copyleft, secrets, SSN) |
| `infra_scan` | Infrastructure security (Docker, CI/CD) |
| `observability_check` | Observability (empty catch, missing logging) |
| `i18n_validate` | i18n key synchronization |
| `doc_coverage` | Documentation-code alignment (JSDoc gaps) |
| `blast_radius` | Transitive impact of changed files (BFS on reverse imports) |
| `act_analyze` | PDCA Act analysis (improvement items) |
| `ai_guide` | AI agent guide queries |
| `audit_submit` | Submit evidence to SQLite EventStore (replaces watch_file) |
| `agent_comm` | Inter-agent communication (post/poll/respond queries) |
| `blueprint_lint` | Naming convention check from Design Phase Blueprint |

## Parliament Protocol

When `parliament.enabled` in config or `quorum parliament` CLI is used:

1. **Diverge-Converge**: 3 roles speak freely (no role constraints), Judge converges into 4 MECE registers + 5-classification (gap/strength/out/buy/build)
2. **Meeting Log**: N sessions accumulate → 3-path convergence (exact/no-new-items/relaxed) → CPS (Context-Problem-Solution) generated
3. **Amendments**: gap classifications auto-propose amendments; majority voting with implementer testimony (no vote)
4. **Enforcement Gates**: 5 gates block work when protocol conditions are violated (amendment/verdict/confluence/design/regression)
5. **Blueprint Lint**: `quorum tool blueprint_lint` checks naming conventions from Design Phase Blueprint against source code

Use `quorum parliament --history` to review past sessions. Use `--mux` for daemon-observable deliberation.

### Full Pipeline (CLI)

```bash
quorum parliament "topic" --rounds 3          # deliberate → CPS
quorum orchestrate plan <track> --provider claude  # interactive planner (Socratic)
quorum orchestrate run <track> --provider claude   # implement → audit → retro → merge
```

The planner uses Socratic questioning in the user's language. If ambiguity is unresolvable, it suggests `quorum parliament "sub-topic"` for deliberation.

## Stagnation Detection

If the audit loop cycles without progress, quorum auto-detects:

- **Spinning**: same verdict 3+ times → recommend lateral thinking
- **Oscillation**: A→B→A→B → recommend halt
- **No drift**: identical codes repeating → recommend escalation
- **Diminishing returns**: improvement declining → recommend escalation
- **Fitness plateau**: fitness score slope ≈ 0 over last N evaluations → recommend escalation

## Session Gate

`session-gate.mjs` blocks Bash/Agent after audit approval until retrospective completes:

- **Blocked**: Bash, Agent, git
- **Allowed**: Read, Write, Edit, Glob, Grep
- **Release**: `echo session-self-improvement-complete`
