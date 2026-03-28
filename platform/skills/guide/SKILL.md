---
name: quorum:guide
description: "Guide for writing evidence packages for the quorum audit. Use when preparing code review submissions, structuring feedback evidence, or addressing audit rejections."
---

# Quorum Evidence Guide

Help the user write a proper evidence package for the quorum audit process.

## Setup

Read `{ADAPTER_ROOT}/core/config.json` to determine the tag values:
- `audit_submit` MCP tool — evidence submission
- `consensus.trigger_tag` / `agree_tag` / `pending_tag` — actual tag values
- `plugin.locale` — locale for templates

All subsequent steps use these values.

## Evidence Format

The evidence must be submitted via `audit_submit` tool and must include these required sections:

```markdown
## [Item Name] [trigger_tag]

### Claim
What was done and why.

### Changed Files
- `path/to/file1.ts`
- `path/to/file2.ts`

### Test Command
npm test

### Test Result
All 28 tests passed. No regressions.

### Residual Risk
None / Description of remaining risks.
```

## Tag Lifecycle

1. Author writes evidence with `[trigger_tag]` — signals "ready for review"
2. Audit runs — evaluator reviews evidence against code diff
3. Verdict: `[agree_tag]` (approved) or `[pending_tag]` (rejected with codes)
4. On rejection: fix issues, re-tag with `[trigger_tag]` to re-enter the cycle

## Key Rules

1. **Never self-approve** — use `trigger_tag` (from config), never `agree_tag`
2. **Test commands must be specific** — no globs, no wildcards
3. **Test results must include actual output** — copy from terminal
4. **Changed files must exist** — must match `git diff --name-only`
5. **Verdicts are in SQLite** — do not look for verdict.md or gpt.md files

## Addressing Rejections

When a previous audit was rejected:

1. Check rejection history: `quorum tool audit_history --summary`
2. Read the rejection reasons from the audit history output
3. Address each rejection point in the new evidence
4. Re-submit with `trigger_tag` — the audit gate re-evaluates automatically

## Execution Context

| Context | Behavior |
|---------|----------|
| **Interactive** | Read config, show template with resolved tags, guide user through each section |
| **Headless** | Read config, scaffold evidence from `git diff`, fill placeholders, submit via audit_submit tool |
