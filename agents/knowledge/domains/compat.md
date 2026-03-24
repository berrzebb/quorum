# Compatibility Reviewer — Domain Knowledge

**Primary tool**: `compat_check`

## Focus Areas
1. **Breaking API changes** — removed/renamed exports, changed signatures
2. **Schema migrations** — backward-compatible alterations, rollback safety
3. **Consumer impact** — downstream dependents affected by changes
4. **Version contracts** — semver compliance, deprecation warnings
5. **Protocol compatibility** — wire format changes, serialization

## Checklist
- [ ] BC-1: No removed public exports without deprecation period
- [ ] BC-2: Schema migrations are reversible
- [ ] BC-3: API signature changes are backward-compatible
- [ ] BC-4: New required fields have defaults for existing data
- [ ] BC-5: Consumer code updated for any breaking changes
- [ ] BC-6: Version bump matches change severity (semver)

## Rejection Codes
- **compat-break**: Breaking change without migration path
- **migration-unsafe**: Schema change not safely reversible
