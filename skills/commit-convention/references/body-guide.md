# Commit Body Guide

Based on Tim Pope (2008), Chris Beams (2014), Git official docs, Google Engineering Practices, Linux Kernel submitting-patches.

## What to Write vs. What to Avoid

| Write this | Avoid this |
|-----------|------------|
| **Why** the change was needed (motivation/problem) | Implementation details visible in the code |
| What was wrong with the previous behavior | "This commit adds..." (redundant) |
| Why this approach was chosen over alternatives | A list of what changed (that's what the diff is for) |
| Trade-offs and known limitations | Explanations relying solely on external links* |
| Issue/ticket references | |
| Concrete numbers when claiming performance gains | |

\* The body must be **self-contained**. It should make sense even if the link breaks.

## Format

```
type(scope): short summary in imperative mood     ← 50 chars or less

                                                  ← blank line (mandatory)
Explain the problem this commit solves. Focus     ← wrap at 72 chars
on why, not how. The diff already shows how.

Further paragraphs separated by blank lines.

 - Bullet points are fine
 - Use a hyphen with a hanging indent

Fixes #123                                        ← issue references last
```

## Examples

**Bug fix — with root cause:**
```
fix(pagination): correct off-by-one error in page offset

The server expects 0-indexed page numbers, but the client was
passing the raw 1-indexed value from the URL. This caused the
first item to always be skipped on page 1.

Added offset = (page - 1) * limit conversion before the API call.

Fixes #456
```

**Feature — with trade-off:**
```
feat(auth): use sliding window for token refresh

The fixed window approach caused abrupt logouts when users made
requests near the expiry boundary — the window reset regardless
of activity.

Sliding window resets the expiry on each active request, keeping
active sessions alive. Load tests show no measurable latency change.

Trade-off: tokens cannot be individually revoked before expiry.
A short-TTL token blocklist is planned as follow-up work.
```

**Refactor — body optional:**
```
refactor(user): move UserService to services/ directory
```
