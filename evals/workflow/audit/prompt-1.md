# Audit Eval Scenario

Run a manual quorum audit for the following evidence:

## Context

- Config: `consensus.trigger_tag = "[REVIEW]"`, `agree_tag = "[AGREED]"`, `pending_tag = "[PENDING]"`
- Provider mapping: `advocate → claude`, `devil → openai`, `judge → claude`
- Evidence has been submitted via `audit_submit` tool with tag `[REVIEW]`
- Evidence contains: Claim (added user auth), Changed Files (3 files), Test Command (npm test), Test Result (28 tests pass)

## Task

Execute `/quorum:audit` for this evidence package.
