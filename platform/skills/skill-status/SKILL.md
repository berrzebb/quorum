---
name: quorum:skill-status
description: "Report loaded skill inventory across canonical and adapter layers. Detects missing wrappers, trigger conflicts, and description mismatches. Use for plugin diagnostics and skill health checks. Triggers on 'skill status', 'skill list', 'loaded skills', 'skill inventory', '스킬 상태', '스킬 목록', '스킬 진단'."
context: fork
mergeResult: false
permissionMode: plan
memory: none
skills: []
tools:
  - read
  - glob
  - grep
hooks: {}
---

# Skill Status

Scan and report the health of quorum's skill ecosystem across all layers: canonical definitions, adapter wrappers, and eval coverage.

## Why This Matters

With 4 adapters and 20+ skills, it's easy for wrappers to fall out of sync — a new canonical skill without adapter wrappers, or a description change that wasn't propagated. Skill-status catches these gaps before they become bugs.

## Pipeline Phase

| Phase | Role | Active |
|-------|------|--------|
| 1–8. All | **Pre-pipeline diagnostic — runs before work begins** | **✅ utility** |

Not bound to a specific phase. Used for plugin health checks at any point.

## Workflow

### Phase 1: Scan Canonical Skills

Scan `skills/*/SKILL.md` for all canonical skill definitions. Extract:
- `name` (from frontmatter)
- `description` (from frontmatter)
- `argument-hint` (from frontmatter, if present)
- Has references? (`skills/{name}/references/` exists)

### Phase 2: Scan Adapter Wrappers

For each adapter (`claude-code`, `gemini`, `codex`, `openai-compatible`), scan `adapters/{adapter}/skills/*/SKILL.md`. Extract:
- `name`, `description`, `model`, `allowed-tools`
- Points to canonical? (contains `skills/{name}/SKILL.md` reference)

### Phase 3: Scan Evals

Scan `evals/*/` for eval definitions. Check:
- `eval.yaml` exists
- `prompt-1.md` exists
- `expected-1.md` exists

### Phase 4: Cross-Reference

Build a compatibility matrix:

```
Skill Inventory (N canonical skills)

| Skill | CC | Gemini | Codex | OAI | Eval | Refs |
|-------|-----|--------|-------|-----|------|------|
| orchestrator | ✅ | ✅ | ✅ | ✅ | ✅ | 2 |
| designer | ✅ | ❌ | ❌ | ❌ | ❌ | 1 |
| btw | ✅ | ✅ | ✅ | ✅ | ✅ | — |
```

### Phase 5: Detect Issues

| Issue Type | Detection Method |
|-----------|-----------------|
| **Missing wrapper** | Canonical exists but adapter wrapper doesn't |
| **Orphan wrapper** | Adapter wrapper exists but no canonical |
| **Description mismatch** | Adapter description differs from canonical |
| **Missing eval** | No eval directory for the skill |
| **Trigger conflict** | Two skills with overlapping trigger phrases |
| **Stale reference** | Reference file path in SKILL.md doesn't exist |

### Phase 6: Report

```
Skill Health Report
━━━━━━━━━━━━━━━━━━

Total: 29 canonical | 16 CC wrappers | 14 Gemini | 14 Codex | 14 OAI
Eval coverage: 22/29 (76%)

⚠️ Issues Found (5):
  1. [missing-wrapper] designer: missing Gemini, Codex, OAI wrappers
  2. [missing-wrapper] fde-analyst: missing all adapter wrappers
  3. [missing-eval] rollback: no eval definition
  4. [description-mismatch] scout: CC description differs from canonical
  5. [trigger-conflict] "status" triggers both quorum:status and quorum:skill-status

✅ Healthy (24 skills): all wrappers present, descriptions match, eval exists
```

## Options

| Flag | Effect |
|------|--------|
| `--detail` | Show full per-skill breakdown instead of summary |
| `--conflicts` | Only show trigger conflicts |
| `--missing` | Only show missing wrappers/evals |
| `--adapter <name>` | Filter to a specific adapter |

## Rules

- Read-only — skill-status never modifies files
- Scan is exhaustive — check every adapter, not just the current one
- Report all issues, not just the first one found
- Trigger conflict detection compares description keywords, not exact strings

## Anti-Patterns

- Do NOT auto-fix issues — report only, let the user decide
- Do NOT skip adapters — all 4 must be checked
- Do NOT treat "missing eval" as blocking — it's a warning, not an error
