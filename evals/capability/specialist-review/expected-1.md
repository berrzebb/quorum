# Specialist Review Expected Output Quality Standards

## 1. Deterministic Tools First

The specialist MUST invoke deterministic tools before LLM reasoning:

- `audit_scan` on `src/middleware/auth.ts` and `src/auth/login.ts` for structural issues
- `perf_scan` for performance-related patterns (optional for security domain)
- Tool results inform the findings — LLM does not fabricate issues that tools would catch

## 2. JSON Output Format

The review output MUST conform to the structured JSON format:

```json
{
  "verdict": "CONDITIONAL_PASS | FAIL | PASS",
  "reasoning": "Summary of security assessment",
  "codes": ["SEC-001", "SEC-002"],
  "findings": [...],
  "confidence": 0.0-1.0
}
```

All 5 fields are required. Verdict must be one of the 3 valid values.

## 3. Confidence-Based Filtering

- Each finding has an individual confidence score (0.0 to 1.0)
- Only findings with confidence >= 0.8 are included in the final output
- Lower-confidence findings may be mentioned in a "potential issues" section but do not affect the verdict

## 4. Finding Limit and Structure

- Maximum 10 findings per review (prevents noise)
- Each finding MUST include:
  - `file`: Full file path (e.g., `src/middleware/auth.ts`)
  - `line`: Line number where the issue occurs
  - `severity`: critical / high / medium / low
  - `code`: Issue code (e.g., SEC-001)
  - `message`: Clear description of the security issue
  - `remediation`: Concrete fix suggestion

## 5. Security Domain Knowledge

For this auth context, the specialist MUST identify at least these security concerns:

- Hardcoded fallback secret (`'default-secret'`) — critical severity
- `(req as any).user` type assertion bypasses type safety — medium severity
- No refresh token implementation — medium severity
- Missing rate limiting on login endpoint — high severity
- Error messages may leak user enumeration info ("User not found" vs "Invalid password") — high severity
- No account lockout after failed attempts — medium severity

## 6. Escalation Hints

- Critical findings (severity: critical) MUST include an escalation hint
- Escalation hint suggests whether the issue should block merge or requires senior review
- Example: "BLOCK: Hardcoded JWT secret fallback must be removed before production deployment"
