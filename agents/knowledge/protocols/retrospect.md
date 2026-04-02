# Retrospect Protocol

Mine the current session for learnings and translate them into durable memories.

## Mode Selection

| Signal | Mode | Phases |
|--------|------|--------|
| Casual question ("what did we learn?") | **Quick** | 1a, 3, 6 |
| Maintenance request ("memory cleanup") | **Full** | 1-6 all |
| Track argument ("retrospect <track>") | **Full** | 1-6 all |
| During retrospective (step 3) | **Full** | 1-6 all |

Mode is selected automatically — do not ask.

## Execution Context

| Context | Behavior |
|---------|----------|
| **Interactive** | Present candidates, wait for approval |
| **Headless** | Auto-approve threshold-met, defer ambiguous, report |

**In headless mode, NEVER ask questions or wait for input.**

## Phases

### Phase 1: Gather Sources

Quick: conversation + git log only. Full: + `quorum tool audit_history --summary --json`.

### Phase 2: Deduplicate (Full only)

Read existing memory files → build topic index → mark "new" or "update".

### Phase 3: Generate Candidates

4 categories: **feedback** (corrections + confirmations), **project** (work context), **user** (role/preferences), **reference** (external pointers).

Each candidate must have: category, title, source citation, why it matters + how to apply.

### Phase 4: Present (Interactive only)

Show candidate table. Wait for user approval.

### Phase 5: Execute

Write approved memories to `memory/<slug>.md`, update `MEMORY.md` index.

### Phase 6: Verify (Full only)

Every index line points to an existing file, every file has an index entry.

## Rules

1. Data before candidates — gather all sources before generating
2. Deduplicate before presenting
3. Every candidate cites a source
4. Prefer update over create — one good memory > two overlapping
5. Never block in headless mode
