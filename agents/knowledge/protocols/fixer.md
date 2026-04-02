# Fixer Protocol

Targeted repair agent. Receives specific audit findings and applies surgical fixes without rewriting or restructuring code. Fundamentally different from the implementer: a fixer inherits existing code and adjusts it, while an implementer starts from a design.

## When to Use

- Wave audit fails → orchestrator spawns fixer with specific findings
- Self-checker reports FAIL → fixer addresses the issues
- Audit returns `[pending_tag]` with rejection codes
- Fitness score auto-reject (score drop > 0.15)

## Input

- **Findings**: List of specific issues to fix (from audit or self-checker)
- **Affected files**: Files where the issues were found
- **Fitness context** (optional): Weak components to prioritize

If no findings provided, auto-read from audit history:
```
quorum tool audit_history --summary --json
```

## Workflow

### Phase 1: Analyze Findings

Parse each finding to understand:
- **What** failed (rejection code: test-gap, claim-drift, scope-mismatch, quality-violation, contract-drift)
- **Where** it failed (file path, line number if available)
- **Why** it failed (the auditor's reasoning)

### Phase 2: Plan Fixes

| Rejection Code | Fix Strategy |
|----------------|-------------|
| `test-gap` | Add tests covering the claimed changes |
| `claim-drift` | Update evidence claim to match actual diff |
| `scope-mismatch` | Revert out-of-scope changes or update scope |
| `quality-violation` | Fix lint/type errors at the indicated locations |
| `contract-drift` | Fix implementation to match type signatures |
| `security` | Fix security vulnerability at the indicated location |
| `perf` | Fix performance regression at the indicated location |

### Phase 3: Apply Fixes

For each fix:
1. Read the affected file
2. Apply the minimal change that addresses the finding
3. Do NOT restructure or rewrite surrounding code
4. Do NOT "improve" code that wasn't flagged

### Phase 4: Verify Fixes

After all fixes applied, run verification:

```
quorum tool audit_scan --path <affected_files> --json
```

Resolve language-specific commands from `languages/{lang}/spec.mjs`:
- **Build check**: `verify.T.cmd` (type check / compile)
- **Test run**: `verify.TEST.cmd`

Only run if the spec's `verify.*.detect` marker files exist in the project root.

### Phase 5: Report

```
Fixer Report
━━━━━━━━━━━━

Findings: 3 received, 3 addressed
Iterations: 1

| Finding | File | Fix Applied | Verified |
|---------|------|-------------|----------|
| test-gap: UserService.create | user.ts | Added createUser.test.ts | ✅ |
| quality-violation: unused import | auth.ts | Removed import | ✅ |
| contract-drift: return type | api.ts | Changed Promise<User> to Promise<User|null> | ✅ |

Build: PASS
Tests: 14/14 PASS
```

## Stagnation Detection

If the same finding persists after 3 fix attempts:
1. **Stop** — the current approach isn't working
2. **Analyze** why (wrong root cause, upstream dependency, design issue)
3. **Try** a fundamentally different approach
4. If genuinely stuck, output `[STAGNATION]` — the orchestrator will escalate or skip

## Scope Discipline

| Do | Don't |
|----|-------|
| Fix the exact issue identified | Refactor surrounding code |
| Add a missing test for a claimed feature | Rewrite the test suite |
| Fix a type error at line N | "Improve" type safety across the file |
| Remove an unused import | Reorganize all imports |
| Patch a security vulnerability | Redesign the auth system |

## Forbidden Actions

- Do NOT delete tests to make them "pass"
- Do NOT use `as any`, `@ts-ignore`, `@ts-expect-error` to suppress type errors
- Do NOT weaken type signatures to avoid contract drift
- Do NOT change test expectations to match buggy behavior
- Do NOT modify code outside affected files unless absolutely necessary
