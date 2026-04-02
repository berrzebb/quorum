# Task Complexity Tiers

Evaluate each task before spawning a worker. Not every task needs the full protocol — applying worktree isolation + scout RTM + audit cycle to a 1-file typo fix wastes 10x the resources.

## Tier Classification

| Tier | Complexity | Files | Criteria | Protocol |
|------|-----------|-------|----------|----------|
| **Tier 1 — Micro** | ≤ 2 | 1~2 | ≤ 3 acceptance criteria | Direct fix, no worktree |
| **Tier 2 — Standard** | 3~7 | 3~8 | 4~8 acceptance criteria | Worktree + audit cycle |
| **Tier 3 — Complex** | ≥ 8 | 8+ or cross-track | 8+ criteria or specialist domain | Worktree + scout RTM + audit + specialist review |

## How to Evaluate

Before distributing a task, score these dimensions:

```
files_affected:  count target files from WB "First touch files"
criteria_count:  count acceptance criteria / done conditions
cross_track:     does the task touch files owned by another track?
domain_risk:     security, auth, payment, data migration → +3
```

**Score = files_affected + criteria_count + (cross_track ? 3 : 0) + domain_risk**

| Score | Tier |
|-------|------|
| ≤ 5 | Tier 1 |
| 6~15 | Tier 2 |
| ≥ 16 | Tier 3 |

## Tier 1 — Micro Delivery

For trivial changes where the full protocol adds more overhead than value.

**Protocol:**
1. Orchestrator describes the change to implementer (no worktree, no `isolation: "worktree"`)
2. Implementer edits directly in main working tree
3. Run `quorum:verify` (CQ + T only, skip CC/CL/S/I/FV/CV)
4. If pass → commit directly (no WIP, no squash merge needed)
5. Skip audit cycle — orchestrator reviews the diff inline
6. No retrospective (trivial change, nothing to learn)

**Examples:**
- Fix a typo in a locale file
- Update a version number
- Add a missing `aria-label`
- Rename a variable for clarity

**When NOT to use Tier 1** (even if score says so):
- File is imported by 4+ other files (high impact)
- Change affects a security-sensitive path
- User explicitly requests full audit

## Tier 2 — Standard Delivery

The default for most feature work. Full quorum protocol.

**Protocol:**
1. Scout (if RTM stale or doesn't exist)
2. Designer (if DRM requires design artifacts)
3. Spawn **implementer** with `isolation: "worktree"`, `run_in_background: true` → code writing only
4. Spawn **self-checker** (haiku) → CQ/T/CC/S/I verification (deterministic tools, zero LLM judgment)
5. Submit evidence → audit cycle
6. If rejected → spawn **fixer** (sonnet) → targeted fixes → re-verify → re-submit
7. On approval → retrospective → squash merge
8. Update handoff

**Examples:**
- Add a new API endpoint with tests
- Implement a UI component with 4 states
- Refactor a module (3-5 files)

## Tier 3 — Complex Delivery

For large, cross-cutting, or high-risk work. Additional safeguards.

**Protocol:**
1. **Mandatory scout** — always re-run, even if RTM exists
2. **Impact analysis** — run `dependency_graph` on all target files, check cross-track consumers
3. **Split check** — if files_affected > 15, consider splitting into multiple Tier 2 tasks
4. **Designer** (opus) — generate design artifacts if DRM requires
5. **FDE-analyst** (opus) — failure analysis for P0/P1 FRs
6. Spawn **implementer** (sonnet) with `isolation: "worktree"` → code writing only
7. Spawn **self-checker** (haiku) → full CQ/T/CC/CL/S/I/FV/CV verification
8. Full audit cycle
9. If rejected → spawn **fixer** (sonnet) → targeted fixes → re-verify → re-submit
10. **Gap-detector** (sonnet) — compare design docs vs implementation (Match Rate)
11. **Post-merge regression** — after squash merge, run project-wide tests
12. Full retrospective with `quorum:retrospect` (Full mode)

**Additional for domain_risk:**
- Security changes → audit must include S category with OWASP perspective
- Payment/auth → require user confirmation before merge (even in headless)
- Data migration → require rollback plan in evidence

**Examples:**
- Architecture change affecting 3+ tracks
- New authentication system
- Database schema migration
- Cross-layer feature (BE + FE + infra)

## Tier Override

The user can override the tier:
- "이건 간단한 수정이야" → force Tier 1
- "이건 꼼꼼하게 해줘" → force Tier 3

In headless mode, the orchestrator cannot ask — use the scored tier.

## Presenting Tier to User (Interactive)

When presenting available tasks, include the tier:

```markdown
## Available Tasks

| # | Task | Tier | Score | Protocol |
|---|------|------|-------|----------|
| 1 | [OR-3] Quality rules | T2 (8) | 3 files, 5 criteria | Worktree + audit |
| 2 | [FE-1] Fix aria-label | T1 (3) | 1 file, 2 criteria | Direct fix |
| 3 | [DT-2] 3D pipeline | T3 (18) | 8 files, cross-track | Worktree + scout + audit |

Select task(s) or override tier (e.g., "2번을 T2로"):
```
