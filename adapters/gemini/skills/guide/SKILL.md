---
name: quorum-guide
description: "Guide for writing evidence packages for the quorum watch file. Use when preparing code review submissions, structuring feedback evidence, or addressing audit rejections. Triggers on 'how to submit evidence', 'evidence format', 'write evidence', 'prepare for audit', 'what goes in the watch file'."
model: gemini-2.5-flash
allowed-tools: read_file, write_file, shell
---

# Quorum Evidence Guide

Help the user write a proper evidence package for the quorum audit process.

## Step 0: Read Config

Read `config.json` to determine the watch file path and tag values:

```bash
shell: cat .quorum/config.json
```

Extract: `watch_file`, `trigger_tag`, `agree_tag` from the config. All subsequent steps use these values.

## Evidence Template

The evidence must be written in the watch file (from config.json) and must include these required sections:

```markdown
## [Item Name] [trigger_tag]

### Claim
What was done and why.

### Changed Files
- `path/to/file1.ts`
- `path/to/file2.ts`

### Test Command
```bash
npm test
```

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
   shell: quorum tool audit_history --summary
   ```
2. Read the rejection reasons from the audit history output
3. Address each rejection point in the new evidence
4. Re-submit with `trigger_tag` — the audit gate re-evaluates automatically

## Execution Context

| Context | Behavior |
|---------|----------|
| **Interactive** | Read config, show template with resolved tags, guide user through each section |
| **Headless** | Read config, scaffold evidence from `git diff`, fill placeholders, write to watch file |
