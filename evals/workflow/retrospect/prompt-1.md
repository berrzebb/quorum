# Retrospect Eval Scenario

Extract learnings from a completed track.

## Context

- Track: `user-auth` (completed, all WBs done)
- Audit history: 3 audits — 1 rejected (missing input validation), 2 approved
- Git log: 12 commits over 2 sessions
- Session had 1 fix cycle (auth middleware rejection → fixed → re-approved)
- User mentioned "always validate request body before auth check" during fix

## Task

Execute `/quorum:retrospect user-auth` to extract learnings.
