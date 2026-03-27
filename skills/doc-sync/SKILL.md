---
name: quorum:doc-sync
description: "Extract facts from code and fix documentation mismatches across 3 layers: L1 public docs (README, AGENTS, TOOLS — EN/KO), L2 RTM, L3 design docs."
---

# Doc-Sync

Extract facts from code and fix numeric/structural mismatches across all documentation layers.

## 3 Layers

| Layer | Scope | Reference |
|-------|-------|-----------|
| **L1** | Public docs (README, AGENTS, TOOLS — EN/KO) | `references/l1-public-docs.md` |
| **L2** | RTM status transitions | `references/l2-rtm.md` |
| **L3** | Design docs (PRD, Work Catalog, Track Map) | `references/l3-design-docs.md` |

## Core Protocol

Read and follow: `agents/knowledge/doc-sync-protocol.md`

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

## 5 Phases

### Phase 1: Fact Extraction

Collect current facts from code (hook counts, tool counts, test counts, event types, language specs). Build a comparison table: `| Fact | Code Value | Doc Value | Match? |`

### Phase 2: L1 — Public Doc Sync

For each L1 target file: compare documented numbers against Phase 1 facts, fix mismatches, verify EN/KO parity (both languages must show identical numbers).

### Phase 3: L2 — RTM Sync (skip if no planning_dir)

Cross-reference requirement status against code state. Update status columns (not-started -> in-progress -> verified).

### Phase 4: L3 — Design Doc Sync (skip if no planning_dir)

Update Work Breakdown status, recalculate Work Catalog numbers, reflect changes in PRD Track Map.

### Phase 5: Report

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
