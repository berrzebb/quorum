---
name: quorum-planner
description: "Design tasks into tracks with work breakdowns. Writes and maintains PRDs, generates DRM-driven documents. Use for feature planning, PRD writing, or adjusting existing plans. Triggers on 'plan', 'add feature', 'write PRD', 'design tasks'."
argument-hint: "<requirement or feature description>"
allowed-tools: read_file, write_file, shell, find_files, search
---

# Planner Protocol

Analyze feature requests, maintain PRDs, define tracks. Do not generate documents immediately — understand, research, confirm scope first.

## Codex Tool Mapping

| Operation | Tool |
|-----------|------|
| Read file | `read_file` |
| Write file | `write_file` |
| Edit file | `apply_diff` |
| Run command | `shell` |
| Find files | `find_files` |
| Search content | `search` |
| Spawn agent | `create_agent` |

## Setup

Config: `.quorum/config.json` — `consensus.planning_dirs`, `plugin.locale`.

## Document Map (10 types)

| Document | Location | Reference |
|----------|----------|-----------|
| PRD | `{planning_dir}/PRD.md` | `references/prd.md` |
| Execution Order | `{planning_dir}/execution-order.md` | `references/execution-order.md` |
| Work Catalog | `{planning_dir}/work-catalog.md` | `references/work-catalog.md` |
| ADR | `{planning_dir}/adr/ADR-{NNN}-{slug}.md` | `references/adr.md` |
| Track README | `{planning_dir}/{track}/README.md` | `references/track-readme.md` |
| Work Breakdown | `{planning_dir}/{track}/work-breakdown.md` | `references/work-breakdown.md` |
| API Contract | `{planning_dir}/{track}/api-contract.md` | `references/api-contract.md` |
| Test Strategy | `{planning_dir}/{track}/test-strategy.md` | `references/test-strategy.md` |
| UI Spec | `{planning_dir}/{track}/ui-spec.md` | `references/ui-spec.md` |
| Data Model | `{planning_dir}/{track}/data-model.md` | `references/data-model.md` |

Read the reference guide before writing any document.

## Execution Context

**Interactive**: ask questions, present drafts, wait for approval. **Headless**: extract intent, auto-approve DRM, generate all, report. Note missing info as `[ASSUMPTION]`.

## Phase 1: Capture Intent

What problem? What does done look like? Who benefits? Scope boundary? Dependencies? Document language?

## Phase 2: PRD

Master document spanning all tracks. Check existing PRD for FR/NFR ID collisions. Decompose into FR + NFR with track assignments. Present draft, confirm (interactive) or auto-proceed (headless).

## Phase 3: Research with Tools

```bash
quorum tool code_map --path src/<dir>/
quorum tool dependency_graph --path src/<dir>/
quorum tool blast_radius --path src/ --changed "<files>"
quorum tool audit_scan --pattern all --json
quorum tool perf_scan --path src/<dir>/
quorum tool coverage_map --path src/<dir>/
```

## Phase 3.5: Change Impact

Run `blast_radius` before WB generation. Ratio > 0.1 = High/Critical. Levels: Low (leaf), Medium (1-3 importers), High (4+ or cross-track), Critical (3+ tracks or interface). Wait for user ack on High/Critical.

## Phase 5: DRM (Document Requirement Matrix)

Track x document-type grid. Each cell: `req`, `n/a`, or `deferred`. Present DRM, confirm, then draft all `req` documents using references.

## Phase 7: Write & Register

Iterate DRM row by row. For each `req`: read reference, write document. Update `PRD.md`, `execution-order.md`, `work-catalog.md`. Output final DRM with `verified` status.

## Phase 8: Completeness Verification

1. `find_files` — verify every `req` cell exists on disk
2. Gap report — compare DRM vs filesystem
3. Resolve gaps, re-check until gap count = 0

## Rules

- PRD before WB — every WB traces to a PRD requirement
- DRM is the contract — every `req` must reach `verified`
- DRM before drafting — no documents without confirmed DRM
- PRD IDs global — FR/NFR numbering never resets
- No vague goals — measurable acceptance criteria only

## Anti-Patterns

- Do NOT generate WBs without PRD requirements
- Do NOT skip research — use `code_map`, `dependency_graph` first
- Do NOT skip DRM — prohibited to write without confirmed DRM
- Do NOT finish with unverified `req` cells
