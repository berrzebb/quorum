---
name: quorum:doc-sync
description: "Extract facts from code and fix documentation mismatches across 3 layers: L1 public docs (README, AI-GUIDE, TOOLS — EN/KO), L2 RTM, L3 design docs. Use before squash commit, after version bump, or when doc numbers look wrong. Triggers on 'sync docs', 'fix docs', 'doc mismatch', 'update documentation numbers', '문서 동기화', 'docs are outdated'."
model: claude-sonnet-4-6
allowed-tools: Read, Grep, Glob, Bash(node *), Bash(npm test*), Bash(ls *), Bash(wc *), Bash(git diff*), Bash(git log*), Bash(git status*), Edit, Write
---

# Doc-Sync

Extract facts from code and fix numeric/structural mismatches across all documentation layers.

## Protocol

Read the full protocol before starting: `${CLAUDE_PLUGIN_ROOT}/../../agents/knowledge/doc-sync-protocol.md`

## References

Layer-specific rules (read the relevant reference before each phase):
- `references/l1-public-docs.md` — Public doc numeric sync rules (hook counts, tool counts, test counts, event types)
- `references/l2-rtm.md` — RTM status transition rules
- `references/l3-design-docs.md` — Design doc status update rules

## Target Documents (L1)

| File | Language | Key Facts |
|------|----------|-----------|
| `README.md` | EN | Version, test count, hook count, tool count, event count |
| `README.ko.md` | KO | Same facts, Korean |
| `docs/en/README.md` | EN | Module map, architecture overview |
| `docs/ko/README.md` | KO | Same, Korean |
| `docs/en/AI-GUIDE.md` | EN | Workflow description, tool references |
| `docs/ko/AI-GUIDE.md` | KO | Same, Korean |
| `docs/en/TOOLS.md` | EN | Tool catalog with parameters |
| `docs/ko/TOOLS.md` | KO | Same, Korean |

## Execution

### Phase 1: Fact Extraction

Run extraction commands to collect current facts from code:

```bash
# Hook count
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
1. Read current content
2. Compare documented numbers against Phase 1 facts
3. Fix mismatches with Edit (preserve surrounding context)
4. Verify EN/KO parity — both languages must show identical numbers

### Phase 3: L2 — RTM Sync

If `planning_dir` exists and contains RTM files:
1. Read RTM files via `rtm_parse` tool
2. Cross-reference requirement status against code state
3. Update status columns (not-started → in-progress → verified)

Skip if no planning directory exists.

### Phase 4: L3 — Design Doc Sync

If `planning_dir` exists:
1. Update Work Breakdown status based on implementation state
2. Recalculate Work Catalog numbers (total items, completed, percentages)
3. Reflect changes in PRD Track Map

Skip if no planning directory exists.

### Phase 5: Report

Output a structured summary:

```markdown
## Doc-Sync Report

### L1: Public Docs
| Fact | Before | After | Files Changed |
|------|--------|-------|---------------|
| Hook count | 20 | 22 | README.md, README.ko.md |

### L2: RTM — [N changes / skipped]
### L3: Design Docs — [N changes / skipped]

Total files modified: N
```

## Execution Context

| Context | Behavior |
|---------|----------|
| **Interactive** | Show fact table → confirm changes → apply → report |
| **Headless** | Auto-extract → auto-fix all mismatches → output report |
