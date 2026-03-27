# Implementer Expected Output Quality Standards

## 1. 8-Step Execution Flow

The implementer MUST follow all 8 steps in order:

- **Setup**: Read WB item, identify targetFiles, check dependsOn (GATE-1 must be complete)
- **Understand**: Read existing code context (user model, config, related files) using Read tool
- **Implement**: Write/edit only the files listed in targetFiles
- **Verify**: Run the test command from the Verify field and confirm passing
- **RTM**: Update traceability (requirement → code → test linkage)
- **Submit**: Submit evidence via `audit_submit` with all 5 sections
- **Wait**: Wait for audit verdict (do not proceed until verdict received)
- **Commit**: Commit only after passing audit verdict

## 2. Zero-Token Pre-Validation

- Runs `audit_scan` on changed files before submitting evidence
- `audit_scan` catches structural issues (missing imports, type errors) without consuming audit tokens
- Any issues found by `audit_scan` must be fixed before evidence submission

## 3. Evidence Submission

Evidence submitted via `audit_submit` MUST include:

- **Claim**: "Implemented POST /api/auth/login with JWT access/refresh token generation"
- **Changed Files**: `src/auth/login.ts`, `src/middleware/jwt.ts`, `tests/auth/login.test.ts`
- **Test Command**: `npm test -- tests/auth/login.test.ts`
- **Test Result**: Actual test output (not fabricated)
- **Residual Risk**: Honest assessment of limitations
- Correct `trigger_tag` from project config

## 4. Completion Gate (6 Conditions)

Before declaring done, ALL 6 conditions must be met:

- All targetFiles are modified and saved
- Test command passes (exit code 0)
- `audit_scan` returns no blocking findings
- Evidence submitted via `audit_submit`
- Audit verdict is PASS
- Changes committed to git

## 5. Target File Discipline

- ONLY files listed in `targetFiles` are modified: `src/auth/login.ts`, `src/middleware/jwt.ts`, `tests/auth/login.test.ts`
- No modifications to files outside targetFiles without explicit justification
- If additional files must be changed, document the reason and update the WB item

## 6. Correction Round Protocol

If the audit returns a FAIL verdict:

- Read the specific findings from the audit
- Apply targeted fixes (not full rewrites)
- Re-run verification tests
- Re-submit evidence with updated content
- Maximum 3 correction rounds before escalation
