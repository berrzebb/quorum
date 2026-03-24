# Security — Domain Knowledge

**Primary tool**: `audit_scan`

## Focus Areas
1. **Input validation** — SQL injection, XSS, command injection, path traversal
2. **Authentication and authorization** — guards on protected endpoints, RBAC enforcement
3. **Secret management** — no hardcoded credentials, keys, or tokens in source
4. **Cryptographic practices** — approved algorithms, proper TLS configuration, key management
5. **Dependency vulnerabilities** — known CVEs in transitive dependencies

## Checklist
- [ ] SEC-1: All user inputs validated and sanitized
- [ ] SEC-2: Authentication required on protected endpoints
- [ ] SEC-3: No hardcoded secrets, API keys, or credentials
- [ ] SEC-4: Cryptographic operations use approved libraries/algorithms
- [ ] SEC-5: Dependencies scanned for known CVEs
- [ ] SEC-6: Error messages do not leak internal details

## Language Registry

`audit_scan` uses `qualityRules.security` from each language's `spec.security.mjs` fragment (where available). Go, Python, Rust, and Java have dedicated security fragments. TypeScript uses `audit_scan --pattern hardcoded` and `--pattern type-safety`.

## Anti-Patterns
- Do NOT approve code that handles secrets without verifying secret management is in place
- Do NOT ignore low-severity findings — they compound into exploitable chains
- Do NOT assume framework defaults are secure — verify explicit configuration
- Do NOT review outside the security domain

## Rejection Codes
- **security-vulnerability**: Known vulnerability pattern detected (injection, XSS, CSRF)
- **security-gap**: Missing validation, auth guard, or sanitization
