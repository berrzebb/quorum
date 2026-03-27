# Expected Retrospect Procedure

## Phase 1: Gather Sources
1. Detect mode: track argument provided → Full mode (all 6 phases)
2. Query audit_history: `quorum tool audit_history --summary --json`
3. Read git log: `git log --oneline -30`
4. Scan conversation for user corrections and confirmations

## Phase 2: Classify Learnings
5. Analyze rejection pattern: missing input validation → feedback memory candidate
6. Analyze user correction: "always validate request body before auth check" → feedback memory
7. Check for repeated patterns (3+ occurrences → auto-learn rule candidate)
8. Identify non-obvious insights (skip patterns derivable from code)

## Phase 3: Filter and Prioritize
9. Apply durable insight test: will this be useful in future conversations?
10. Discard ephemeral task details (current conversation context)
11. Discard code patterns derivable from reading the codebase
12. Keep: input validation ordering insight (feedback type)

## Phase 4: Write Memories
13. Create memory file with frontmatter format (name, description, type)
14. Feedback memory: "Validate request body before auth middleware processing"
15. Include Why line and How to apply line
16. Update MEMORY.md index with pointer to new memory file

## Phase 5: Verify
17. Confirm memory file exists and has valid frontmatter
18. Confirm MEMORY.md updated with new entry
19. Mark retro as complete: update retro-marker.json

## Phase 6: Report
20. Present summary of extracted learnings (N saved, M filtered, K deferred)
21. In headless mode: write summary to file and exit without prompting
