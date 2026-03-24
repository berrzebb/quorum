---
name: quorum:retrospect
description: "Extract learnings from audit history, manage memories. Use after completing a track, during retrospective, or for memory maintenance. Triggers on 'what did we learn', 'retrospective', 'memory cleanup', '회고', '메모리 정리'."
argument-hint: "[track name or 'all']"
model: claude-sonnet-4-6
allowed-tools: Read, Write, Grep, Glob, Bash(node *), Bash(git log*)
---

# Retrospect Protocol

Mine the current session for learnings and translate them into durable memories. Sessions generate massive amounts of information — your job is to find the fraction worth remembering, structure it properly, and persist it.

## Mode Selection

| Signal | Mode | Phases | When |
|--------|------|--------|------|
| Casual question ("what did we learn?") | **Quick** | 1a, 3, 6 | Simple summary, end-of-session |
| Maintenance request ("memory cleanup") | **Full** | 1-6 all | Memory audit, bulk operations |
| Track argument ("/retrospect OR") | **Full** | 1-6 all | Deep track analysis |
| During retrospective (step 3) | **Full** | 1-6 all | Post-audit protocol |

Mode is selected automatically — do not ask the user.

## Execution Context

| Context | Detection | Behavior |
|---------|-----------|----------|
| **Interactive** | Main session, user present | Present candidates, wait for approval, execute |
| **Headless** | Subagent, no human | Auto-approve threshold-met candidates, defer ambiguous, execute, report |

**In headless mode, NEVER ask questions or wait for input.** Auto-approve what meets threshold rules, defer the rest as deferred to orchestrator.

## Claude Code Tool Mapping

| Operation | Tool |
|-----------|------|
| Read file | `Read` |
| Write file | `Write` |
| Find files | `Glob` |
| Search content | `Grep` |
| Run command | `Bash` |

## Setup

Read config: `.quorum/config.json` -> `plugin.locale`

Locate memory: use `Glob` to find `**/memory/MEMORY.md`. Read it to understand existing memories (avoid duplicates, check line count < 200).

## Phases

### Phase 1: Gather Sources

**Quick mode**: conversation + git log only (skip audit_history).
**Full mode**: conversation + audit_history + git log.

```bash
# Audit history (full mode only)
quorum tool audit_history --summary --json

# Recent git activity
git log --oneline -30
```

### Phase 2: Deduplicate (Full mode only)

Read existing memory files -> build topic index -> mark candidates as "new" or "update".

### Phase 3: Generate Candidates

4 categories: **feedback** (corrections + confirmations), **project** (work context), **user** (role/preferences), **reference** (external pointers).

Each candidate must have:
- Category and title
- Source citation (conversation turn, audit verdict, git SHA)
- Why it matters + how to apply (feedback/project types)

### Phase 4: Present (Interactive only)

Show candidate table with category, title, action (create/update/skip). Wait for user approval.

### Phase 5: Execute

Write approved memories:
- New entries -> create `memory/<slug>.md`, add index line to `MEMORY.md`
- Updates -> edit existing file, update index description
- Deletions -> remove file, remove index line

### Phase 6: Verify (Full mode only)

Integrity check: every index line in `MEMORY.md` points to an existing file, every file in `memory/` has an index entry.

## Integration with Retrospective

When invoked during post-audit retrospective (step 3 — Memory cleanup):
- This skill handles memory extraction and cleanup
- Other retro steps (what went well, problems, feedback, Act) continue independently
- Learnings needing code changes -> work-catalog items (not memories)

## Memory Authority

Only **this skill and agents** may read/write memories. Other skills must not access the memory directory directly.

| Actor | Memory Access |
|-------|-------------|
| `quorum:retrospect` | Read + Write (primary owner) |
| Agents (orchestrator, implementer) | Read only (via auto-memory system) |
| Other skills | **No access** — request via orchestrator if needed |

## Rules

1. **Data before candidates** — gather all sources before generating
2. **Deduplicate before presenting** — check existing memories first (Full mode)
3. **Every candidate cites a source** — no unsupported claims
4. **User approves everything** (interactive) / **auto-approve with thresholds** (headless)
5. **Why + How to apply** required for feedback/project types
6. **Prefer update over create** — one good memory > two overlapping
7. **Show what you skipped** — user may disagree with threshold
8. **Verify after execution** — MEMORY.md integrity check (Full mode)
9. **Never block in headless mode** — no questions, no prompts
10. **Memory authority** — only this skill writes memories; other skills must not touch memory files
