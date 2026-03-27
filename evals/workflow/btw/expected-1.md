# Expected: BTW Suggestion Lifecycle

## Procedure Steps

1. Parse the suggestion text
2. Auto-categorize as "pattern" (signal: "every time", repeated work)
3. Capture context: current file path, active task ID, session ID
4. Append to `.claude/quorum/btw.jsonl` as JSONL entry with id, text, category, timestamp, context
5. Confirm recording without disrupting workflow
6. When listing: read btw.jsonl, display with category icons
7. When analyzing: scan for 3+ similar entries, report recurring patterns
8. Suggest promotion path if pattern count >= 3
