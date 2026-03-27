# Expected Commit Convention Procedure

## Step 1: Analyze Staged Changes
1. Analyzes staged changes by running git diff --staged --stat before writing any message
2. Run git diff --staged to read actual code changes
3. Identify: middleware.ts has input validation (feat), login.ts has error handling refactor (refactor)

## Step 2: Determine Commit Granularity
4. Check: subject needs "and" to describe both changes → YES (validation AND refactoring)
5. Check: multiple Conventional Commit types → YES (feat + refactor)
6. Decision: SPLIT into 2 commits

## Step 3: Split Recommendation
7. Commit 1: feat(auth): add request body validation to middleware
   - Files: src/auth/middleware.ts, tests/auth.test.ts (validation tests)
8. Commit 2: refactor(auth): simplify error handling in login endpoint
   - Files: src/auth/login.ts, tests/auth.test.ts (error handling tests)

## Step 4: Subject Line Rules
9. Use English — project CLAUDE.md conventions take precedence over defaults
10. 50 characters or less per subject
11. Imperative mood ("add" not "added")
12. No period at end
13. Lowercase after type prefix

## Step 5: Body (if needed)
14. Explain WHY, not WHAT (the diff shows what)
15. Wrap at 72 characters
16. Separate from subject by blank line
