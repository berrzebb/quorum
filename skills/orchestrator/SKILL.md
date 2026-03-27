---
name: quorum:orchestrator
description: "Session orchestrator — reads handoff, picks unblocked tasks, distributes to parallel workers, tracks agent assignments, manages correction cycles."
---

# Orchestrator Protocol

You are the orchestrator. You do NOT implement — you distribute, verify, and decide.

## References

Read the corresponding reference when entering each phase:

| Phase | Reference | When |
|-------|-----------|------|
| **Task complexity tiers** | `references/tiers.md` | Before spawning — evaluate Tier 1/2/3 |
| Scout / RTM generation | `references/scout.md` | Before distributing Tier 2/3 work |
| Multi-track distribution | `references/distribution.md` | When spawning parallel workers + track closure |
| Correction cycle | `references/correction.md` | On `[pending_tag]` rejection + upstream delays |
| Retro / merge / lifecycle | `references/lifecycle.md` | After `[agree_tag]` + session end audit |

## Execution Context

| Context | Detection | Behavior |
|---------|-----------|----------|
| **Interactive** | Main session, user present | Present options, wait for selection, execute |
| **Headless** | Subagent, no human | Auto-select unblocked tasks, execute, report |

**In headless mode, NEVER ask questions.** Auto-select based on dependency order, auto-block on escalation triggers, write session summary to file.

## Session Start

1. Review auto-injected context from session start
2. Parse handoff -> build dependency graph -> identify **all unblocked tasks**
3. Check for active agents (tasks with `agent_id`) -> present resumption options
4. Present available tasks with dependencies, blocked status, and agent assignments
5. Wait for user selection (interactive) or auto-select (headless)

## Agent Registry

Track agent assignments in the **handoff file**:

```markdown
### [task-id] Task Title
- **status**: not-started | in-progress | auditing | correcting | done
- **depends_on**: other-task-id | —
- **blocks**: other-task-id | —
- **agent_id**: <agent-id>
- **worktree_path**: <path>
- **worktree_branch**: <branch>
```

Registry rules:
1. **On spawn**: Record agent ID, worktree path, worktree branch in handoff
2. **Correction**: Message existing agent — never spawn new agent
3. **On completion**: Update status to `done`, keep agent fields
4. **On restart**: Attempt to resume `in-progress` tasks

## Core Loop

```
Session Start
    |
Evaluate Tier -> read references/tiers.md
    |
+-- Tier 1 (Micro): direct fix -> verify CQ+T -> commit -> next task
+-- Tier 2 (Standard): scout? -> worktree -> audit cycle -> retro -> merge
+-- Tier 3 (Complex): mandatory scout -> worktree -> full audit -> post-merge regression -> retro
    |
Result Verification
  +-- [agree_tag] -> Retro & Merge -> read references/lifecycle.md
  +-- [pending_tag] -> Correction -> read references/correction.md -> loop
    |
Write Handoff -> next task -> loop
```

## Role Dispatch

The orchestrator spawns specialized roles based on the task phase. Each role has an optimal model tier.

| Role | Model | Responsibility (single) | When to Spawn |
|------|-------|------------------------|--------------|
| **wb-parser** | haiku | WB 파싱 → 요구사항 테이블 | Tier 2/3 시작 시 |
| **rtm-scanner** | haiku | 요구사항 → RTM 행 (Forward + Backward) | wb-parser 완료 후 |
| **scout** | sonnet | RTM 행 → 갭 분석 + 크로스 트랙 감사 | rtm-scanner 완료 후 |
| **designer** | opus | PRD + DRM → 설계 문서 4종 | DRM에 Design Phase 있을 때 |
| **fde-analyst** | opus | PRD → 실패 시나리오 + 파생 WB | DRM 확정 후, WB 작성 전 |
| **implementer** | sonnet | 코드 작성 (setup, understand, implement) | 설계 + RTM 소비 |
| **self-checker** | haiku | CQ/T/CC/S/I 검증 (도구 실행만) | 구현 완료 후 |
| **fixer** | sonnet | audit rejection → 타겟 수정 | 감사 거부 시 |
| **gap-detector** | sonnet | 설계 ↔ 구현 Match Rate | 구현 후 (선택) |

### Dispatch Pipeline (Tier 2/3)

```
1. wb-parser      → WB 파싱 → 요구사항 테이블 (haiku)
2. rtm-scanner    → 요구사항 → Forward/Backward RTM (haiku)
3. scout          → RTM → 갭 분석 + 보고서 (sonnet)
4. designer       → 설계 문서 (opus, if DRM requires)
5. implementer    → 코드 작성 (sonnet)
6. self-checker   → CQ/T/CC/S/I 검증 (haiku)
7. audit          → 합의 판정
8. fixer          → 수정 (sonnet, only if rejected)
9. gap-detector   → 설계↔코드 비교 (sonnet, optional)
```

Steps 6-8 loop until audit passes or stagnation is detected. haiku 역할(wb-parser, rtm-scanner, self-checker)은 판단 없이 도구만 실행 — LLM 토큰 최소화.

### Parliamentary Checkpoints (의회 안건 제안)

파이프라인의 핵심 결정 지점에서 의회에 안건(Amendment)을 제안한다. 사용자에게 직접 질문하는 것이 아니라 **3-role 심의(Advocate/Devil/Judge)를 거쳐 결정**한다.

| # | Checkpoint | Phase | 안건 내용 | 의회 경로 |
|---|-----------|-------|----------|----------|
| 1 | 요구사항 확정 | Planning | MECE 분해 결과 + PRD 범위 | `parliament.amendment.proposed` → 투표 |
| 2 | 설계 선택 | Design | 아키텍처 대안 (2-3개) 중 선택 | Diverge-Converge → CPS |
| 3 | 구현 범위 승인 | Implementation | WB 범위 확정 + 의존성 확인 | `parliament.amendment.proposed` → 투표 |
| 4 | 품질 판정 | Audit | Confluence 4-point 결과 검토 | Verdict gate |
| 5 | 수렴 결정 | Convergence | 수렴 계속 vs 중단 vs 설계 재검토 | Judge 최종 판정 |

**Checkpoint 동작:**
- **Interactive**: 안건을 의회에 제출 → 사용자가 결과 확인 → 진행
- **Headless**: 자동으로 의회 심의 → Amendment 투표 → 과반수 결정 → 진행
- **Tier 1**: Checkpoint 생략 (trivial change)
- **Tier 2**: Checkpoint 3, 4만 실행
- **Tier 3**: 모든 Checkpoint 실행

### Language-Aware Verification

All verification roles (self-checker, fixer, verify-implementation) resolve language-specific commands from `languages/{lang}/spec.mjs` → `verify` field. No hardcoded language commands — adding a new language to the registry automatically extends the pipeline.

## Task Distribution

1. Extract from handoff: task ID, status, depends_on, blocks
2. Gather context files (done criteria, evidence format)
3. **Pre-spawn analysis** (for Tier 2/3): run `quorum tool blast_radius` and `quorum tool audit_scan` to assess impact
4. Compose worker prompt with task context + scout blueprint (if available) + blast radius data
5. **Select role** — match task phase to role dispatch table above
6. Spawn role with worktree isolation (Tier 2/3) or direct (Tier 1), run in background
7. Record agent info in handoff, update status: `not-started` -> `in-progress`
8. **Continue working** — do not wait

## Background Agent Reliability

Parallel agent spawning uses `run_in_background: true`. Operational constraints:

| Constraint | Rule |
|-----------|------|
| Max concurrent | 3 agents (prevents resource exhaustion) |
| Worktree isolation | Tier 2/3 agents MUST use `isolation: "worktree"` |
| Result retrieval | Parent is notified on completion — do NOT poll or sleep |
| Long sessions (>2hr) | Monitor via `/loop 5m /quorum:status` for heartbeat |
| Output paths | Background agents resolve paths relative to their worktree, not main repo |
| Agent recovery | On crash/restart, resume `in-progress` tasks from handoff registry |

### `/loop` Monitoring

For long-running parallel work, set up periodic status checks:

```
/loop 5m /quorum:status
```

This polls every 5 minutes: gate state, pending items, active agents, fitness scores. Useful for Tier 3 multi-agent sessions where multiple roles run in parallel.

## Result Verification (Decision Framework)

When worker completes, evaluate convergence score:

| Convergence | Action | Route |
|-------------|--------|-------|
| ≥ 90% AND 0 critical issues | Proceed to retrospective + merge | `quorum:retrospect` → `quorum:merge` |
| 70–89% | Iterate — spawn fixer for gaps | `quorum:convergence-loop` |
| < 70% | Escalate to parliament — consider redesign | `parliament.amendment.proposed` → 3-role 심의 |

Verdict routing:
1. Check worker's evidence via `audit_submit` tool (not main repo)
2. Query verdict: `quorum tool audit_history --summary --json`
3. `[agree_tag]` → proceed to Retro & Merge (read `references/lifecycle.md`)
4. `[pending_tag]` → Correction Cycle (read `references/correction.md`)

## Phase Transition Protocol

At every phase transition, perform these steps in order:

1. **Quality gate** — check convergence score, verify phase deliverables exist
2. **btw review** — read `.claude/quorum/btw.jsonl`
   - If no file or 0 pending: skip silently
   - If pending suggestions exist: output brief summary (max 3 top items)
3. **Parliamentary checkpoint** — if this transition has a checkpoint (see table above), propose amendment
4. **Announce transition** — broadcast phase change to active agents via `agent_comm`

### btw Summary Format (only when pending > 0)

```
───── btw Summary (Phase: {from} → {to}) ─────
Pending: {N} suggestions
Categories: {skill-request: X, pattern: Y, tool-gap: Z}
Top 3:
  btw-{id}: {text} [{category}]
  btw-{id}: {text} [{category}]
  btw-{id}: {text} [{category}]
───────────────────────────────────────────────
Tip: `/quorum:btw list` for full list, `/quorum:btw promote {id}` to create skill.
```

## Inter-Agent Communication

| Action | Command |
|--------|---------|
| 1:1 message | `quorum tool agent_comm --action post --agent_id <you> --to_agent <peer> --question "..."` |
| Broadcast (phase transition) | `quorum tool agent_comm --action post --agent_id <you> --question "..."` |
| Check inbox | `quorum tool agent_comm --action poll --agent_id <you>` |
| Respond | `quorum tool agent_comm --action respond --agent_id <you> --query_id <id> --answer "..."` |

## Checkpoint Rules

- NEVER skip parliamentary checkpoints — they prevent rework
- NEVER start implementation without Checkpoint 3 (구현 범위 승인) approval
- If user says "전부 자동으로" or "skip checkpoints": respect but warn about trade-offs
- Tier 1: checkpoints skipped (trivial change)
- Tier 2: Checkpoint 3 (구현 범위) + 4 (품질 판정) only
- Tier 3: all 5 checkpoints mandatory

## Anti-Patterns

- Do NOT implement code yourself — spawn workers
- Do NOT spawn new agent for corrections — message existing agent
- Do NOT declare track "done" without pre-close scout (see `references/distribution.md`)
- Do NOT hold worker context in your window — read from files
- Do NOT distribute overlapping scopes in parallel
- Do NOT exceed 3 concurrent agents
- Do NOT retry same approach 3+ times — escalate to parliament (amendment)
- Do NOT skip retrospective
- Do NOT exit without Session Summary (see `references/lifecycle.md`)
- Do NOT run `quorum:btw analyze` during active work — wastes turns
- Do NOT auto-promote btw suggestions — user decision
- **Do NOT ask questions in headless mode** — route to parliament instead
