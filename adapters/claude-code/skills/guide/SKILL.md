---
name: quorum:guide
description: "Guide for writing evidence packages for the quorum watch file. Use when preparing code review submissions, structuring feedback evidence, or addressing audit rejections. Triggers on 'how to submit evidence', 'evidence format', 'write evidence', 'prepare for audit', 'what goes in the watch file', '증거 작성'."
version: 1.0.0
model: claude-sonnet-4-6
allowed-tools: Read, Grep, Bash(node *), Bash(git diff *), Bash(git status *)
---

# quorum — Evidence Package Guide

When submitting code changes for consensus review, write a properly structured evidence package in the watch file.

## Step 0: Read Config

Read `${CLAUDE_PLUGIN_ROOT}/core/config.json` first:
- `consensus.watch_file` → submission path
- `consensus.trigger_tag` / `agree_tag` / `pending_tag` → actual tag values
- `plugin.locale` → locale for templates

Note: verdicts are stored in **SQLite**, not in separate markdown files. Use `quorum status` or `audit_history` tool to check previous verdicts.

## Step 1: Write Evidence

Follow the format defined in `${CLAUDE_PLUGIN_ROOT}/core/templates/references/${locale}/evidence-format.md`.

Required sections: **Claim**, **Changed Files**, **Test Command**, **Test Result**, **Residual Risk**.

Key rules:
- **Test Command** must be executable as-is — no glob patterns, use explicit file paths
- **Test Result** must be actual terminal output, not summaries
- **Claim** must match the actual code changes (verify with `git diff`)
- **Changed Files** paths must use backtick formatting
- Every changed file must pass the per-file checks from `quality_rules.presets`
- Use a single **Write** to the watch file (not sequential Edits)

## Step 2: Tag Lifecycle

```
[trigger_tag] → auditor reviews → verdict in SQLite
                                  ├→ [agree_tag] applied → retro → merge
                                  └→ [pending_tag] applied → fix → re-submit
```

## Step 3: Addressing Rejections

When auditor returns `[pending_tag]`:

1. Check rejection details: `node ${CLAUDE_PLUGIN_ROOT}/core/tools/tool-runner.mjs audit_history --summary`
2. Common rejection codes: `test-gap`, `claim-drift`, `scope-mismatch`, `quality-violation`
3. Fix each cited issue at the specific file:line locations
4. Update the evidence package with corrected claims, tests, and results
5. Keep the `[trigger_tag]` to trigger a new audit cycle

Full rejection code reference: `${CLAUDE_PLUGIN_ROOT}/core/templates/references/${locale}/rejection-codes.md`

## Execution Context

| Context | Behavior |
|---------|----------|
| **Interactive** | Walk through evidence preparation step by step |
| **Headless** | Generate evidence from git diff → write to watch file → apply trigger_tag |
