# Expected: 5-Point Verification

## Procedure Steps

1. Identify changed files (3 files provided)
2. Detect language: TypeScript (.ts extensions)
3. CQ Check:
   - Run `quorum tool audit_scan --path src/auth/session.ts,src/auth/middleware.ts --json`
   - Run `npx tsc --noEmit`
   - Run `npx eslint src/auth/session.ts src/auth/middleware.ts`
4. T Check:
   - Run `npm test` or `npx jest tests/auth.test.ts`
   - Run `quorum tool coverage_map --path src/auth/session.ts,src/auth/middleware.ts --json`
   - Verify changed functions have test coverage
5. CC Check:
   - Compare changed files against target files
   - Note: `tests/auth.test.ts` is extra (not in target list) — flag as WARN not FAIL
6. S Check:
   - Run `quorum tool audit_scan --pattern security --path src/auth/ --json`
   - Check for unvalidated inputs, exposed secrets
7. I Check:
   - Run `quorum tool i18n_validate --path src/auth/ --json`
   - Check for hardcoded user-facing strings
8. Aggregate results into structured report table
9. Determine overall status (PASS/WARN/FAIL)
10. No files modified — report only
