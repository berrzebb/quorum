# Expected Verification Procedure

## Step 1: Gather Evidence Context
1. Gathers evidence context before running checks — read config, extract trigger_tag
2. Query evidence via audit_history — find section with trigger_tag. Stops if no evidence found with trigger_tag.
3. Parse evidence: Claim, Changed Files, Test Command, Test Result, Residual Risk
4. Extract changed file list: middleware.ts, login.ts, auth.test.ts
5. Detects project languages via language registry (TypeScript auto-detected)

## Step 2: Code Quality (CQ)
Runs all 8 categories in order: CQ, T, CC, CL, S, I, FV, CV. Uses deterministic tools for each category.

6. Run audit_scan on changed files — check for `as any`, hardcoded values, console.log
7. Run perf_scan — nested loops, sync I/O, unbounded queries
8. Run compat_check — deprecated API usage
9. Run observability_check — empty catch blocks, missing error context
10. Apply TypeScript-specific quality rules from language registry fragments

## Step 3: Test (T)
11. Execute test command: `npm test`
12. Verify direct tests exist for changed source files
13. Verify test file auth.test.ts covers middleware.ts and login.ts

## Step 4: Claim-Code (CC)
14. Run git diff to get actual changed files
15. Compare diff scope vs claimed Changed Files
16. Run blast_radius to assess transitive impact
17. Flag any undeclared file modifications

## Step 5: Cross-Layer (CL)
18. Run dependency_graph on changed files
19. Check BE→FE contract consistency
20. Run import cycle detection
21. Verify consumer existence for exported APIs

## Step 6: Security (S)
22. Run audit_scan with hardcoded pattern — secrets, API keys
23. Run license_scan — PII patterns, license compliance
24. Check auth guard coverage on login endpoint
25. Verify input validation on auth middleware

## Step 7: i18n (I)
26. Run i18n_validate — locale key parity
27. Check for hardcoded user-facing strings in changed files

## Step 8: Frontend (FV)
28. Run a11y_scan — accessibility violations
29. Run doc_coverage — documentation completeness
30. Check build succeeds with changed files

## Step 9: Coverage (CV)
31. Run coverage_map — per-file coverage percentages
32. Verify statement coverage >= 85% (87% — PASS)
33. Verify branch coverage >= 75% (78% — PASS)

## Step 10: Report
34. Present pass/fail per category with specific findings
35. Aggregate: all 8 categories pass → ready for evidence submission
