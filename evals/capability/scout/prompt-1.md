# Scout Eval Prompt

Generate RTM for the user-auth track with 4 work breakdown items.

## Context

Track: `user-auth`

### Work Breakdown Items

| ID    | Title                          | Target Files                                      |
|-------|--------------------------------|---------------------------------------------------|
| WB-1  | User registration endpoint     | `src/auth/register.ts`, `src/models/user.ts`      |
| WB-2  | Login with JWT token           | `src/auth/login.ts`, `src/middleware/jwt.ts`       |
| WB-3  | Password reset flow            | `src/auth/reset.ts`, `src/services/email.ts`      |
| WB-4  | Rate limiting middleware       | `src/middleware/rate-limit.ts`, `src/config/limits.ts` |

### Requirements

- FR-1: Users can register with email and password
- FR-2: Users can login and receive JWT access/refresh tokens
- FR-3: Users can reset password via email verification
- FR-4: Auth endpoints are rate-limited (max 10 requests/minute)
- NFR-1: Passwords hashed with bcrypt (cost factor >= 12)
- NFR-2: JWT tokens expire within 15 minutes

## Instructions

Follow the scout protocol to generate a complete Requirements Traceability Matrix. Use deterministic tools first (code_map, dependency_graph) to gather structural data, then apply LLM reasoning for gap analysis.
