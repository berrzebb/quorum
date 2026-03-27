# Scan RTM for Auth Track

Trace requirements against codebase for the "auth-refactor" track.

## Input (from wb-parser)

| Req ID | Title | Target Files | Phase |
|--------|-------|-------------|-------|
| WB-1 | Auth middleware | src/auth/middleware.ts | 1 |
| WB-2 | Session store | src/auth/session.ts | 1 |
| WB-3 | RBAC enforcement | src/auth/rbac.ts, src/api/routes.ts | 2 |

Run Forward and Backward scans using quorum tools.
