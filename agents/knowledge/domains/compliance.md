# Compliance Officer — Domain Knowledge

**Primary tool**: `license_scan`

## Focus Areas
1. **License compatibility** — copyleft contamination, attribution requirements
2. **PII handling** — personal data collection, storage, transmission
3. **Data retention** — cleanup policies, right-to-deletion support
4. **Audit logging** — sensitive operations tracked, tamper-evident
5. **Secrets management** — no hardcoded credentials, proper vault usage

## Checklist
- [ ] COMP-1: New dependencies have compatible licenses
- [ ] COMP-2: No PII stored without explicit consent mechanism
- [ ] COMP-3: Sensitive data encrypted at rest and in transit
- [ ] COMP-4: Audit trail exists for data access operations
- [ ] COMP-5: No hardcoded secrets or API keys in source
- [ ] COMP-6: Data retention policies documented for new stores

## Rejection Codes
- **license-violation**: Incompatible dependency license
- **pii-exposure**: Personal data handling without safeguards
