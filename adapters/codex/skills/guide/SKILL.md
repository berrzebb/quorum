---
name: quorum-guide
description: "Guide for writing evidence packages for the quorum audit. Use when preparing code review submissions or addressing audit rejections. Triggers on 'how to submit evidence', 'evidence format', 'write evidence'."
model: codex
allowed-tools: read_file, write_file, shell
---

# Quorum Evidence Guide

Help the user write a proper evidence package for the quorum audit process.

## Codex Tool Mapping

| Operation | Tool |
|-----------|------|
| Read file | `read_file` |
| Write file | `write_file` |
| Run command | `shell` |

## Step 0: Read Config

Read `config.json` to determine the tag values:

```bash
cat .quorum/config.json
```

Extract: `trigger_tag`, `agree_tag` from the config. Use `audit_submit` tool for evidence submission. All subsequent steps use these values.

## Evidence Template

The evidence must be submitted via `audit_submit` tool and must include these required sections:

```markdown
## [Item Name] [trigger_tag]

### Claim
What was done and why.

### Changed Files
- `path/to/file1.ts`
- `path/to/file2.ts`

### Test Command
\```bash
npm test
\```

### Test Result
All 28 tests passed. No regressions.

### Residual Risk
None / Description of remaining risks.
```

## Key Rules

1. **Never self-approve** — use `trigger_tag` (from config), never `agree_tag`
2. **Test commands must be specific** — no globs, no wildcards
3. **Test results must include actual output** — copy from terminal
4. **Changed files must exist** — must match `git diff --name-only`
5. **Verdicts are in SQLite** — do not look for verdict.md or gpt.md files

## Handling Rejections

When a previous audit was rejected:

1. Check rejection history:
   ```bash
   quorum tool audit_history --summary
   ```
2. Read the rejection reasons from the audit history output
3. Address each rejection point in the new evidence
4. Re-submit with `trigger_tag` — the audit gate re-evaluates automatically

## Execution Context

| Context | Behavior |
|---------|----------|
| **Interactive** | Read config, show template with resolved tags, guide user through each section |
| **Headless** | Read config, scaffold evidence from `git diff`, fill placeholders, submit via audit_submit tool |
