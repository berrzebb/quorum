# Audit Flow Scenario

> End-to-end: evidence submission → trigger → audit → verdict → retro → commit

## Overview

This scenario traces a single code change through quorum's full consensus pipeline.

## Scenario: Developer edits `src/api/users.ts`

### Step 1: Evidence Capture

Developer (or AI agent) edits a file. The `PostToolUse` hook fires on `Edit|Write`.

```
PostToolUse [Edit] fires
  └─▶ platform/adapters/claude-code/index.mjs
      ├── Read changed file list from tool_input
      ├── Build evidence context (file path, change type, diff summary)
      └── Forward to platform/core/bridge.mjs
```

### Step 2: Fitness Gate

Before any LLM sees the code, deterministic quality metrics are computed.

```
Fitness Score Engine (7 components):
  ├── typeSafety:     tsc --noEmit result        → 0.95
  ├── testCoverage:   vitest coverage            → 0.82
  ├── patternScan:    audit_scan findings         → 0.90
  ├── buildHealth:    npm run build exit code     → 1.00
  ├── complexity:     cyclomatic complexity       → 0.88
  ├── security:       license_scan + audit_scan   → 1.00
  ├── dependencies:   outdated/vulnerable deps    → 0.95
  │
  └── Overall: 0.93 (weighted average)

Decision:
  score drop > 0.15 → AUTO-REJECT (no audit needed)
  score drop > 0.05 → SELF-CORRECT (implementer fixes first)
  otherwise         → PROCEED to trigger evaluation
```

### Step 3: Trigger Evaluation (13 Factors)

The trigger system scores the change to determine audit tier.

```
Factor Evaluation:
  ├── f1  File risk:        src/api/ → 0.12 (API layer = elevated)
  ├── f2  Blast radius:     dependency_graph BFS → 8 dependents → 0.10
  ├── f3  Cross-layer:      API + DB layer touched → 0.08
  ├── f4  Security:         auth-related patterns → 0.15
  ├── f5  API surface:      public endpoint changed → 0.10
  ├── f6  Test coverage:    coverage_map gap → 0.05
  ├── f7  Rejection history: 0 recent rejections → 0.00
  ├── f8  Stagnation:       no patterns detected → 0.00
  ├── f9  Domain complexity: perf domain detected → 0.05
  ├── f10 Line count:       42 lines changed → 0.03
  ├── f11 New file:         existing file → 0.00
  ├── f12 Config file:      not config → 0.00
  ├── f13 Interaction:      security × blast-radius → ×1.3
  │
  └── Total: 0.89 → T3 (deliberative consensus)

Tier Thresholds:
  score < 0.3 → T1 (skip audit)
  score < 0.6 → T2 (solo auditor)
  score ≥ 0.6 → T3 (3-role deliberative)
```

### Step 4: Domain Detection (Zero-Cost)

File patterns determine which specialist domains are relevant.

```
src/api/users.ts:
  ├── Pattern: src/api/* → perf domain detected
  ├── Pattern: *user*auth* → security domain detected
  │
  └── Activated:
      ├── perf_scan → N+1 query check, sync I/O detection
      └── (security via audit_scan patterns)
```

### Step 5: Specialist Tools Run

Deterministic MCP tools produce facts for the auditor.

```
Tool Results:
  ├── code_map:        12 symbols in users.ts
  ├── blast_radius:    8 files transitively depend on users.ts
  ├── perf_scan:       1 finding — sync database call in async handler
  ├── audit_scan:      0 type-safety issues, 0 console.log
  └── coverage_map:    users.test.ts covers 78% of users.ts
```

### Step 6: T3 Deliberative Consensus

Three auditors evaluate the evidence independently, then converge.

```
Phase A — Diverge (free discussion):
  ├── Advocate:       "The endpoint refactor improves response time.
  │                    New pagination parameter is well-typed."
  ├── Devil's Advocate: "The sync DB call in the handler is a symptom fix.
  │                      The root cause is missing connection pooling.
  │                      perf_scan confirms: sync I/O in async context."
  └── Judge:          "Both perspectives noted. Sync call is factual."

Phase B — Converge (4 MECE registers):
  ├── Status Changes:     API endpoint signature changed (pagination added)
  ├── Decisions:          Sync→async DB migration needed
  ├── Requirement Changes: None
  └── Risks:              Sync call under load → event loop blocking

Phase C — Classify:
  ├── Gap:     Connection pooling not addressed
  ├── Strength: Pagination implementation is correct
  └── Build:   Async DB wrapper needed

Verdict: REJECT
  Reason: "Sync database call in async handler (perf_scan finding confirmed).
           Fix the root cause (connection pooling) before re-submitting."
```

### Step 7: Implementer Correction

The implementer receives the specific rejection feedback and corrects.

```
Rejection feedback:
  ├── Finding: sync I/O in async handler
  ├── Root cause: missing connection pooling
  ├── Suggested fix: async DB wrapper
  │
  └── Implementer makes targeted fix (not full rewrite)
      └── Re-submits evidence
```

### Step 8: Re-Audit (Pass)

The corrected code goes through the same pipeline. This time:

```
Fitness: 0.94 (improved — no sync I/O)
Trigger: 0.72 → T3 (still deliberative — same risk profile)
perf_scan: 0 findings
Verdict: APPROVE
```

### Step 9: Confluence Verification

Post-audit integrity check ensures whole-system coherence.

```
Confluence (4-point verification):
  ├── Law↔Code:     Audit verdict matches implementation ✓
  ├── Part↔Whole:   Integration tests pass ✓
  ├── Intent↔Result: CPS gap list unchanged ✓
  └── Law↔Law:      No amendment contradictions ✓
  │
  └── All clear → proceed to retro
```

### Step 10: Retrospective

Learnings extracted from the audit cycle for future pattern detection.

```
Retro:
  ├── Pattern detected: "sync I/O in API handlers"
  ├── Occurred: 1 time (below auto-learn threshold of 3)
  ├── Memory: not saved (need 3+ occurrences for CLAUDE.md suggestion)
  └── Trigger factor adjusted: perf domain weight += 0.02
```

### Step 11: Commit

With audit approved and confluence verified, the change is ready to commit.

```
State transition: audit.verdict → retro.complete → ready to commit
```

## Timing

| Step | Typical Duration | LLM Tokens |
|------|-----------------|------------|
| Evidence capture | <1s | 0 |
| Fitness gate | 2-5s | 0 |
| Trigger evaluation | <1s | 0 |
| Domain detection | <1ms | 0 |
| Specialist tools | 1-3s | 0 |
| T3 consensus | 30-60s | ~8,000 |
| Confluence | <1s | 0 |
| Retro | 5-10s | ~2,000 |
| **Total** | **~40-80s** | **~10,000** |

Note: Steps 1-5 are fully deterministic — no LLM tokens spent.

## Related Documents

- [Architecture Overview](../README.md) — system structure
- [Consensus Protocol](../philosophy/consensus-protocol.md) — why 3-role deliberation
- [Tools Overview](../components/_tools-overview.md) — MCP tools used in steps 5-6
- [Agents Overview](../components/_agents-overview.md) — specialist agents
