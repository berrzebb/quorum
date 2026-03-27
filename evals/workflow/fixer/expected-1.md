# Expected: Surgical Fix Pipeline

## Procedure Steps

1. Parse 3 findings with rejection codes
2. For test-gap (UserService.create):
   - Read src/services/user.ts to understand create() signature
   - Create or update test file with test for create()
   - Test covers the claimed behavior
3. For quality-violation (unused import):
   - Read src/auth/middleware.ts line 3
   - Remove the unused Logger import
   - Do NOT reorganize other imports
4. For contract-drift (return type):
   - Read the contract type definition
   - Fix the implementation return type to match: Promise<User | null>
   - Do NOT change the contract — fix the implementation
5. Run build check: `npx tsc --noEmit`
6. Run tests: `npm test`
7. Verify all 3 findings are addressed
8. Output structured fix report with per-finding status
9. Test count did not decrease
10. No `as any` or `@ts-ignore` was used
