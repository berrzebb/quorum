# Expected Audit Procedure

## Step 1: Config Resolution
1. Read config.json to extract consensus tag values (trigger_tag, agree_tag, pending_tag)
2. Read consensus.roles to determine provider-per-role mapping
3. Identify auditor providers: advocate=claude, devil=openai, judge=claude

## Step 2: Evidence Retrieval
4. Query evidence from SQLite via audit_submit tool or audit_history
5. Parse evidence sections: Claim, Changed Files, Test Command, Test Result, Residual Risk
6. Validate evidence format — all required sections present

## Step 3: Trigger Evaluation
7. Evaluate 13-factor trigger score (file count, blast radius, domain, complexity, etc.)
8. Determine tier: T1 (skip) / T2 (simple) / T3 (deliberative)
9. Route to appropriate audit mode based on tier

## Step 4: Domain Detection
10. Run zero-cost domain detection on changed files (file pattern matching)
11. Activate specialist tools for detected domains
12. Enrich evidence with specialist findings if applicable

## Step 5: Consensus Execution
13. Send evidence to assigned providers (advocate, devil, judge)
14. Collect verdicts with confidence scores
15. Apply voting rules (majority, confidence weighting, tie-breaking)

## Step 6: Verdict Storage
16. Store verdict in SQLite via bridge.recordTransition()
17. Write audit-status.json marker file for fast-path hook detection
18. Emit audit.verdict event to EventStore
19. Do NOT write verdict.md or gpt.md — these are eliminated

## Step 7: Post-Verdict
20. Display verdict result via quorum status
21. If changes_requested: provide rejection codes and specific file:line references
22. If approved: signal ready for retro/commit flow
