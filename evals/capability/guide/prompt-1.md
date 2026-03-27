# Guide Eval Prompt

Help me write evidence for my auth middleware implementation.

## Context

I just finished implementing JWT authentication middleware in `src/middleware/auth.ts`. The middleware:

- Extracts Bearer token from Authorization header
- Validates JWT signature and expiration
- Attaches decoded user payload to `req.user`
- Returns 401 for missing/invalid tokens

Changed files:
- `src/middleware/auth.ts` (new file)
- `src/types/express.d.ts` (added `user` to Request)
- `tests/middleware/auth.test.ts` (new test file)

All tests pass: `npm test -- tests/middleware/auth.test.ts` (6 passing).

## Instructions

Guide me through writing proper evidence for this implementation. Show the exact format I should use, explain each section, and help me avoid common mistakes.
