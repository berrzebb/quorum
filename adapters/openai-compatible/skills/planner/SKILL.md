---
name: quorum-planner
description: "Design tasks into tracks with work breakdowns. Writes and maintains PRDs, generates DRM-driven documents. Triggers on 'add feature X', 'plan Z', 'write PRD', 'design tasks', '기능 추가', '설계'."
argument-hint: "<requirement or feature description>"
context: fork
model: claude-opus-4-6
allowed-tools: read, write, grep, glob, bash(node *), bash(cat *), bash(ls *)
---

# Planner Protocol

## References

Shared references at `skills/planner/references/`. Read the relevant reference before each phase.

Analyze feature requests, maintain PRDs, define tracks. Do not generate documents immediately — understand, research, confirm scope first.

## Tool Mapping

| Operation | Tool |
|-----------|------|
| Read file | `read` |
| write file | `write` |
| Find files | `glob` |
| Search content | `grep` |
| Run command | `bash` |

## Tool References

For tool parameters and examples, see: `skills/consensus-tools/references/`
For planner document templates, see: `skills/planner/references/`

## Setup

Config: `.quorum/config.json` — `consensus.planning_dirs`, `plugin.locale`.

## Document Map (11 types)

| Document | Level | Location | Reference |
|----------|-------|----------|-----------|
| PRD | Project | `{planning_dir}/PRD.md` | `skills/planner/references/prd.md` |
| Execution Order | Project | `{planning_dir}/execution-order.md` | `skills/planner/references/execution-order.md` |
| Work Catalog | Project | `{planning_dir}/work-catalog.md` | `skills/planner/references/work-catalog.md` |
| ADR | Project | `{planning_dir}/adr/ADR-{NNN}-{slug}.md` | `skills/planner/references/adr.md` |
| Track README | Track | `{planning_dir}/{track}/README.md` | `skills/planner/references/track-readme.md` |
| Work Breakdown | Track | `{planning_dir}/{track}/work-breakdown.md` | `skills/planner/references/work-breakdown.md` |
| API Contract | Track | `{planning_dir}/{track}/api-contract.md` | `skills/planner/references/api-contract.md` |
| Test Strategy | Track | `{planning_dir}/{track}/test-strategy.md` | `skills/planner/references/test-strategy.md` |
| UI Spec | Track | `{planning_dir}/{track}/ui-spec.md` | `skills/planner/references/ui-spec.md` |
| Data Model | Track | `{planning_dir}/{track}/data-model.md` | `skills/planner/references/data-model.md` |
| **Design Phase** | Track | `{planning_dir}/{track}/design/` | `skills/planner/references/design-phase.md` |

Read the reference guide before writing any document. References at: `skills/planner/references/`.

## Execution Context

**Interactive**: ask questions, present drafts, wait for approval. **Headless**: extract intent, auto-approve DRM, generate all, report. Note missing info as `[ASSUMPTION]`.

## Phase 0: CPS Intake (Parliament Integration)

Before capturing intent, check if a **Parliament CPS** (Context-Problem-Solution) exists from prior deliberation sessions.

**Check**: Read `.claude/parliament/cps-*.md` files, or call `quorum status` for CPS availability.

If CPS exists:
1. **CPS.Context → PRD §1** (Problem & Background): Use as-is from parliament deliberation.
2. **CPS.Problem → PRD §2** (Goals & Success Metrics): Extract gap items as goals.
3. **CPS.Solution → PRD §4** (Tracks & Requirements): Build items become FR candidates.
4. **CPS.Gaps → Phase 1.5 seed**: Pre-populate MECE decomposition with parliament's 5-classification gaps.
5. **Skip Phase 1** if CPS covers the full intent. Proceed to Phase 1.5 with CPS-derived actors/systems.

If CPS does NOT exist: Proceed to Phase 1 as normal.

In **headless mode**: Always check for CPS first. If found, use it as sole intent source.

## Phase 1: Capture Intent

What problem? What does done look like? Who benefits? Scope boundary? Dependencies? Document language?

## Phase 1.5: MECE Decomposition

Before writing the PRD, perform structured requirements decomposition. Read `skills/planner/references/mece-decomposition.md` for the full guide.

1. **Actor Decomposition** — identify all stakeholders (ME: no role overlap)
2. **System Decomposition** — derive required systems per actor (ME: clear boundaries)
3. **Domain Coverage** — check cross-cutting concerns (CE: no gaps)

Present Actor Map + System Map + Domain Checklist to user. **Wait for confirmation before Phase 2.**

In headless mode, extract actors/systems from prompt context. Mark uncertain domains as `[ASSUMPTION]`.

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

## Phase 4: Check Conflicts

Verify against existing plans: `execution-order.md`, `work-catalog.md`. Cross-reference Phase 3.5 impact results. Present conflicts for user decision.

## Phase 5: DRM (Document Requirement Matrix)

Track x document-type grid. Each cell: `req`, `n/a`, or `deferred`. Present DRM, confirm, then draft all `req` documents using references.

**Design Phase is mandatory** for tracks with CPS origin or 3+ WB items. DRM must include Design Phase row with `req` for applicable artifacts. See `skills/planner/references/design-phase.md`. **Design before WB** — naming conventions in Blueprint are binding law.

## Phase 5.5: FDE Failure Checklist

After DRM confirmation, before drafting Work Breakdowns, analyze failure scenarios for P0/P1 FRs. Read `skills/planner/references/fde-checklist.md` for the full guide.

1. For each P0/P1 FR, build a failure table (scenario, severity, impact, mitigation, new WB?)
2. HIGH severity failures — mandatory new WB
3. MEDIUM severity failures — new WB unless explicitly deferred by user
4. Present failure analysis and derived WBs to user

**Wait for confirmation before proceeding to WB drafting.**

In headless mode, auto-generate failure analysis for external dependencies and data persistence. Note assumptions as `[FDE-ASSUMPTION]`.

## Phase 6: Review & Iterate

Present draft summary (new FRs, WB items, dependencies). Apply feedback until user confirms.

## Phase 7: Write & Register

Iterate DRM row by row. For each `req`: read reference, write document. Update `PRD.md`, `execution-order.md`, `work-catalog.md`. Output final DRM with `verified` status.

## Phase 8: Completeness Verification

1. `Glob` — verify every `req` cell exists on disk
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
