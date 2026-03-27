# Guide Expected Output Quality Standards

## 1. Evidence Format Completeness

The guide MUST show the complete 5-section evidence format:

- **Claim**: What was implemented and why (ties back to WB item)
- **Changed Files**: List of all modified/created files with brief description of each change
- **Test Command**: Exact command to reproduce verification (e.g., `npm test -- tests/middleware/auth.test.ts`)
- **Test Result**: Actual test output showing pass/fail status (not just "all tests pass")
- **Residual Risk**: Known limitations, edge cases not covered, or technical debt introduced

## 2. Trigger Tag Usage

- References the correct `trigger_tag` from the project's `config.json`
- Shows how the tag is embedded in the evidence content
- Explains that the tag enables the audit trigger system to evaluate the evidence

## 3. Tag Lifecycle Explanation

The guide MUST explain the 3-phase lifecycle:

- **Created**: Evidence is drafted with the trigger_tag
- **Submitted**: Evidence is submitted via `audit_submit` MCP tool (stored in EventStore)
- **Evaluated**: Trigger system evaluates the 13 factors and routes to appropriate audit tier

## 4. Concrete Example

- Provides a filled-in evidence example specific to the auth middleware context
- Uses actual file paths from the prompt (`src/middleware/auth.ts`, etc.)
- Includes realistic test output snippets
- Residual risk mentions concrete items (e.g., "token refresh not implemented", "no rate limiting on auth endpoints")

## 5. Common Mistakes Warning

The guide MUST warn about at least 3 common evidence mistakes:

- Vague claims without specific implementation details
- Missing or fabricated test results
- Omitting residual risk section
- Not listing all changed files
- Using wrong trigger_tag format
