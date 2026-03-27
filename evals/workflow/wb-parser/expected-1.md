# Expected: Requirement Extraction

## Procedure Steps

1. Read `plans/execution-order.md` for track sequencing
2. Read `plans/auth-refactor/work-breakdown.md`
3. Parse each WB heading: extract ID (WB-1..WB-5), Title, Size
4. Parse each WB body: extract Action, Verify, Target files, dependsOn
5. Resolve GATE-N references to Phase dependencies
6. Build dependency graph (detect cycles if any)
7. Output structured requirements table with all 5 WBs
8. Output dependency summary showing execution order
9. Report any parsing errors (missing fields, malformed headings)
10. No code analysis tools invoked — parse only
