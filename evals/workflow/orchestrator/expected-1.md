# Expected Orchestrator Procedure

## Step 1: Pre-flight
1. Load track work-breakdown from planning directory
2. Run Plan Review gate — validate Action + Verify fields exist per WB
3. Check design documents exist (Design gate)
4. Parse blueprint naming rules (Blueprint Rules gate)
5. Check RTM status
6. Check parliament gates (amendment, confluence, design, regression)

## Step 2: Baseline
7. Take fitness baseline snapshot
8. Record git baseline ref for regression detection

## Step 3: Wave Computation
9. Parse Phase gates — Phase 1 must complete before Phase 2
10. Within Phase 1: topological sort on dependsOn
11. Wave 1: WB-1.1 and WB-1.3 (no deps, run in parallel, concurrency=2)
12. Wave 2: WB-1.2 (depends on WB-1.1, runs after Wave 1)
13. Wave 3 (Phase 2): WB-2.1 (depends on WB-1.1 and WB-1.2)

## Step 4: Wave 1 Execution
14. Select model for WB-1.1 (Size S → haiku) and WB-1.3 (Size S → haiku)
15. Detect domains from target files for domain-aware routing
16. Build implementer prompts with domain knowledge injection
17. Spawn 2 agents in parallel (concurrency limit met)
18. Wait for both agents to complete

## Step 5: Wave 1 Quality Gates
19. Run regression check (git diff against baseline)
20. Scan for stubs, perf anti-patterns, dependency audit
21. Check file scope violations, blueprint lint
22. Run fitness gate (auto-reject if score drop > 0.15)
23. Verify test file creation for new modules
24. Check WB constraints compliance

## Step 6: Wave 1 Audit
25. Run wave-level audit with combined evidence
26. If audit fails: spawn Fixer with specific findings + fitness context
27. Fixer applies targeted fixes (max 3 attempts)
28. Detect fix loop stagnation (spinning/oscillation/no-progress)
29. If stagnation detected: halt wave, rollback

## Step 7: Wave 1 Commit
30. WIP commit for completed wave items
31. Save wave state to wave-state-user-auth.json
32. Update completedIds, lastCompletedWave, lastFitness

## Step 8: Repeat for Wave 2, Wave 3
33. Same gate chain per wave
34. Phase 2 items only start after all Phase 1 waves complete

## Step 9: E2E Verification
35. Run project-wide tests, fitness final, stub scan, perf scan
36. Check orphan files, blueprint violations, AST analysis
37. Auto-learn from audit patterns
38. Normal form convergence report

## Step 10: Completion
39. Retro extraction
40. Merge readiness check
