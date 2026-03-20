## [REVIEW_NEEDED] FVM-2 -- fvm_validate MCP Tool

### Forward RTM Rows

| Req ID | File | Exists | Impl | Test Case | Test Result | Status |
|--------|------|--------|------|-----------|-------------|--------|
| FVM-2 | scripts/fvm-validator.mjs | yes | yes | tests/fvm-validator.test.mjs | 39/39 pass | fixed |
| FVM-2 | scripts/mcp-server.mjs | yes | yes | tests/mcp-tools.test.mjs | 29/29 pass | fixed |
| FVM-2 | tests/fvm-validator.test.mjs | yes | yes | self | 39/39 pass | fixed |

### Claim

Implemented fvm_validate MCP tool (FVM-2). The tool:
- Parses FVM Verification Matrix tables from markdown files (parseFvmRows)
- Authenticates each role via POST /api/auth/login, stores Set-Cookie (buildAuthTokenMap)
- Executes HTTP requests sequentially with 100ms delay (executeRow)
- Classifies failures as AUTH_LEAK, FALSE_DENY, ENDPOINT_MISSING, or PARAM_ERROR (classifyFailure)
- Handles dynamic path params (:id, :name) with placeholder substitution (substituteDynamicParams)
- Handles connection refused and timeout gracefully (executeRow error handling)

Implementation: scripts/fvm-validator.mjs (10 exported functions, 299 lines).
Registered in scripts/mcp-server.mjs (handleRequest made async to support await).

### Changed Files

**Code:** scripts/fvm-validator.mjs, scripts/mcp-server.mjs
**Tests:** tests/fvm-validator.test.mjs

### Test Command

node --test tests/fvm-validator.test.mjs
node --test tests/mcp-tools.test.mjs

### Test Result

fvm-validator.test.mjs: tests 39, pass 39, fail 0
mcp-tools.test.mjs (regression): tests 29, pass 29, fail 0
audit-scan type-safety fvm-validator.mjs: (none found)
audit-scan hardcoded fvm-validator.mjs: (none found)

### Residual Risk

- All tests use createServer() mock; no live server tested
- Tool depends on fvm_generate Verification Matrix table format
- filter_route is substring-based
