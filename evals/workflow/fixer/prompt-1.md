# Fix Audit Findings

The Wave 2 audit failed with the following findings:

## Findings

1. `test-gap`: UserService.create() has no unit test (src/services/user.ts:45)
2. `quality-violation`: Unused import 'Logger' (src/auth/middleware.ts:3)
3. `contract-drift`: Method return type `Promise<User>` doesn't match contract `Promise<User | null>` (src/services/user.ts:48)

## Affected Files

- src/services/user.ts
- src/auth/middleware.ts

Fix all findings with minimal changes. Do not refactor or restructure.
