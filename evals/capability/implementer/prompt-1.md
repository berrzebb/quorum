# Implementer Eval Prompt

Implement WB-1.2: Login endpoint with JWT token validation.

## Work Breakdown Item

```
### WB-1.2: Login endpoint with JWT validation [S]

- **Action**: Create POST /api/auth/login endpoint. Validate email/password against database. Generate JWT access token (15min) and refresh token (7d). Return tokens in response body.
- **Verify**: `npm test -- tests/auth/login.test.ts` passes. Manual test: `curl -X POST http://localhost:3000/api/auth/login -H "Content-Type: application/json" -d '{"email":"test@example.com","password":"test123"}'` returns 200 with tokens.
- **targetFiles**: [`src/auth/login.ts`, `src/middleware/jwt.ts`, `tests/auth/login.test.ts`]
- **dependsOn**: GATE-1
- **Size**: S
```

## Project Context

- Framework: Express.js with TypeScript
- Database: PostgreSQL via Prisma ORM
- Auth: JWT (jsonwebtoken package)
- Password: bcrypt with cost factor 12
- Config: `src/config/auth.ts` has JWT_SECRET and token durations
- User model already exists at `src/models/user.ts` (from WB-1.1)

## Instructions

Implement this WB item following the implementer protocol. Show the complete execution flow from setup through commit.
