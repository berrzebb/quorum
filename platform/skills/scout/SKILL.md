---
name: quorum:scout
description: "Analyze RTM data to produce gap reports, cross-track audits, and bidirectional summaries. Consumes structured output from wb-parser and rtm-scanner. Single responsibility: requirement gap analysis. Triggers on 'scout', 'gap report', 'RTM analysis', 'RTM 분석', '갭 보고서'."
---

# Scout

Analyze RTM rows to identify gaps, orphans, and cross-track issues. One responsibility: turn raw tracing data into actionable gap reports.

## Role Boundaries

Scout is the **analyzer** in a 3-role pipeline:

| Role | Responsibility | Model |
|------|---------------|-------|
| `quorum:wb-parser` | WB files → structured requirements table | haiku |
| `quorum:rtm-scanner` | Requirements → Forward + Backward RTM rows | haiku |
| **`quorum:scout`** (this skill) | RTM rows → gap analysis + reports | sonnet |

The scout does NOT parse WBs or run code analysis tools — those are upstream roles. The scout receives structured data and applies judgment.

## Core Protocol

Read and follow: `agents/knowledge/scout-protocol.md`

Note: The protocol describes the full 8-phase pipeline. With role separation, the scout handles **Phase 5-8 only**:

| Phase | Handled By |
|-------|-----------|
| Phase 1-2: Dependency graph + Extract requirements | `wb-parser` |
| Phase 3-4: Forward + Backward scan | `rtm-scanner` |
| **Phase 5: Bidirectional summary** | **scout** |
| **Phase 6: Cross-track connection audit** | **scout** |
| **Phase 7: Gap report** | **scout** |
| **Phase 8: Output verification** | **scout** |

## Input

- **Forward RTM** table (from rtm-scanner)
- **Backward RTM** table (from rtm-scanner)
- **Requirements table** (from wb-parser) — for context on what each Req ID means

## Workflow

### Phase 5: Bidirectional Summary

Cross-reference Forward and Backward RTMs:
- **Gap**: Requirement exists in Forward RTM but has no test (Test Case = `—`)
- **Orphan**: Test exists in Backward RTM but maps to no requirement (Mapped Req = `—`)
- **Partial**: Requirement exists but implementation is incomplete (Impl = `⚠️ partial`)
- **Missing**: Requirement's target file doesn't exist (Exists = `❌`)

### Phase 6: Cross-Track Connection Audit

Using the dependency data from RTM rows:
- Flag imports that cross track boundaries
- Identify broken links (imports to files that don't exist)
- Assess coupling between tracks (high coupling = risk for parallel execution)

### Phase 7: Gap Report

Write `{planning_dir}/gap-report-{domain}.md`:

```markdown
# Gap Report: {track}

## Summary
| Metric | Count |
|--------|-------|
| Total requirements | N |
| Fully implemented | N |
| Gaps (no test) | N |
| Orphan tests | N |
| Missing files | N |

## Gaps (priority order)
1. WB-3: src/auth/rbac.ts — file not created, 0% coverage
2. WB-2: src/auth/session.ts — partial implementation, no tests

## Cross-Track Issues
- WB-4 imports from track "data-layer" (WB-7) — verify interface stability
```

### Phase 8: Output Verification

Confirm all outputs exist and are internally consistent.

## Completion Gate (5 Conditions)

| # | Condition | Verification |
|---|-----------|-------------|
| 1 | Forward RTM consumed | All rows analyzed |
| 2 | Backward RTM consumed | All rows analyzed |
| 3 | Bidirectional summary produced | Gap + orphan counts |
| 4 | Gap report written | File exists |
| 5 | Cross-track issues documented | Section present (even if empty) |

## Anti-Patterns

- Do NOT run code analysis tools — that's the rtm-scanner's job
- Do NOT parse WB files — that's the wb-parser's job
- Do NOT modify code — scout is read-only
- Do NOT invent Req IDs — use only IDs from the requirements table
