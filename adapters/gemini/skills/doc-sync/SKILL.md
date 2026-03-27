---
name: quorum:doc-sync
description: "Extract facts from code and fix documentation mismatches across 3 layers: L1 public docs (README, AGENTS, TOOLS — EN/KO), L2 RTM, L3 design docs. Use before squash commit, after version bump, or when doc numbers look wrong. Triggers on 'sync docs', 'fix docs', 'doc mismatch', 'update documentation numbers', '문서 동기화'."
model: gemini-2.5-flash
allowed-tools: read_file, write_file, edit_file, shell, glob, grep
---

# Doc-Sync

Extract facts from code and fix numeric/structural mismatches across all documentation layers.

## Protocol

Read the full protocol before starting: `agents/knowledge/doc-sync-protocol.md`

## Target Documents (L1)

| File | Language | Key Facts |
|------|----------|-----------|
| `README.md` | EN | Version, test count, hook count, tool count, event count |
| `README.ko.md` | KO | Same facts, Korean |
| `docs/README.md` | EN | Module map, architecture overview |
| `docs/ko-KR/README.md` | KO | Same, Korean |
| `docs/AGENTS.md` | EN | Workflow description, tool references |
| `docs/ko-KR/AGENTS.md` | KO | Same, Korean |
| `docs/TOOLS.md` | EN | Tool catalog with parameters |
| `docs/ko-KR/TOOLS.md` | KO | Same, Korean |

## Execution

### Phase 1: Fact Extraction

Run extraction commands via `shell` to collect current facts from code:

```bash
# Hook count (sum across all adapters)
grep -r '"event"' adapters/*/hooks/hooks.json | wc -l

# Tool count
ls core/tools/*.mjs | grep -v tool-runner | wc -l

# Test count
npm test 2>&1 | tail -5

# Event types
grep -c "'" bus/events.ts

# Language specs
ls languages/*/spec.mjs | wc -l
```

Collect all facts into a comparison table: `| Fact | Code Value | Doc Value | Match? |`

### Phase 2: L1 — Public Doc Sync

For each L1 target file:
1. Read current content with `read_file`
2. Compare documented numbers against Phase 1 facts
3. Fix mismatches with `edit_file` (preserve surrounding context)
4. Verify EN/KO parity — both languages must show identical numbers

### Phase 3: L2 — RTM Sync (skip if no planning_dir)

1. Find RTM files via `glob` in the planning directory
2. Cross-reference requirement status against code state using `grep`
3. Update status columns (not-started -> in-progress -> verified)

### Phase 4: L3 — Design Doc Sync (skip if no planning_dir)

1. Update Work Breakdown status based on implementation state
2. Recalculate Work Catalog numbers (total items, completed, percentages)
3. Reflect changes in PRD Track Map

### Phase 5: Report

Output a structured summary:

```
## Doc-Sync Report
### L1: Public Docs
| Fact | Before | After | Files Changed |
### L2: RTM — [N changes / skipped]
### L3: Design Docs — [N changes / skipped]
Total files modified: N
```

## Execution Context

| Context | Behavior |
|---------|----------|
| **Interactive** | Show fact table, confirm changes, apply, report |
| **Headless** | Auto-extract, auto-fix all mismatches, output report |
