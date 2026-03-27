# Expected: Convergence Loop

## Procedure Steps

1. Initial evaluation: aggregate self-checker + gap-detector + confluence results
2. Calculate convergence score: fitness(0.72x40%) + pass_rate(60%x40%) + confluence(50%x20%) = 62.8%
3. Criteria failed: T (2 tests), S (1 finding), Confluence (Law<->Code)
4. Spawn fixer with 3 findings: test gaps + security finding + confluence mismatch
5. Fixer applies targeted fixes
6. Re-evaluate: spawn self-checker + gap-detector + confluence
7. Check stagnation: are the same criteria failing?
8. If improving -> continue loop
9. If all pass -> output SUCCESS convergence report
10. If stagnation -> output STAGNATION report with [STAGNATION] marker
