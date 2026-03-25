---
name: quorum:audit
description: "Run a quorum audit manually — trigger consensus review, re-run failed audits, test audit prompts, or force a specific provider. Use when the hook-based auto-trigger didn't fire, or you want explicit control. Triggers on 'run audit', 'audit again', 'review my code', 'check evidence'."
argument-hint: "[--dry-run | --no-resume | --auto-fix | --model <name>]"
model: claude-sonnet-4-6
allowed-tools: Read, Bash(node *), Bash(git *)
---

# Manual Audit (Claude Code)

Trigger the consensus audit process manually. Evaluates pending evidence items and produces verdicts stored in SQLite.

## Claude Code Tool Mapping

| Operation | Tool |
|-----------|------|
| Read file | `Read` |
| Run command | `Bash` |

## Execute

```bash
node ${CLAUDE_PLUGIN_ROOT}/core/audit.mjs {{ arguments }}
```

## Setup

Read config with `Read` at `${CLAUDE_PLUGIN_ROOT}/core/config.json`:
- `audit_submit` MCP tool — evidence submission
- `consensus.trigger_tag` / `agree_tag` / `pending_tag` — tag values
- `consensus.roles` — provider-per-role mapping (advocate, devil, judge)

## Options

| Flag | Effect |
|------|--------|
| `--dry-run` | Print the audit prompt without executing — use to preview what will be sent |
| `--no-resume` | Start a fresh session (discard any saved Codex session) |
| `--auto-fix` | After audit, auto-correct rejected items via Claude CLI |
| `--model <name>` | Override auditor model (default from config) |
| `--reset-session` | Delete saved session state before running |
| `--evidence <markdown>` | Submit evidence directly (useful for worktree audits) |

## Verdict Flow

Verdicts are stored in **SQLite** (not markdown files). The flow:

```
audit.mjs → provider reviews evidence
  → verdict stored via bridge.recordTransition()
  → audit-status.json marker written (fast-path for hooks)
  → quorum status shows result
```

Do NOT look for verdict.md or gpt.md — these files are eliminated. Use `quorum status` or `audit_history` tool.

## After Completion

Check the audit result:

```bash
node ${CLAUDE_PLUGIN_ROOT}/core/tools/tool-runner.mjs audit_history --summary
```

Or use `quorum status` to see current gate state.

Interpret the result:
- **[agree_tag]** — consensus reached, proceed to retrospective then merge
- **[pending_tag]** — rejection with codes; read rejection reasons, fix issues, re-submit evidence
- **No verdict** — audit may have failed; check stderr output

## Execution Context

| Context | Behavior |
|---------|----------|
| **Interactive** | Run audit, show verdict summary, suggest next steps |
| **Headless** | Run audit, output verdict, exit (caller reads audit-status.json) |

In headless mode, do NOT ask follow-up questions. Output the result and exit.

## Common Rejection Codes

| Code | Meaning | Fix |
|------|---------|-----|
| `test-gap` | Missing or insufficient tests | Add tests covering the claimed changes |
| `claim-drift` | Evidence claim doesn't match actual diff | Update claim to match git diff |
| `scope-mismatch` | Changed files not listed in evidence | Update Changed Files section |
| `quality-violation` | Code quality check failed | Fix lint/type errors |
