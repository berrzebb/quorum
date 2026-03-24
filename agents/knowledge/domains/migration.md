# Migration — Domain Knowledge

**Primary tool**: `compat_check`

## Focus Areas
1. **Schema backward compatibility** — additive-only changes preferred; destructive changes require migration plan
2. **Data migration safety** — idempotent operations with rollback procedures
3. **API version management** — breaking changes behind versioned endpoints or feature flags
4. **Feature flag coverage** — breaking changes gated for incremental rollout
5. **Migration ordering** — respect foreign key dependencies and cross-table constraints

## Checklist
- [ ] MIG-1: Schema changes are backward-compatible (or migration plan exists)
- [ ] MIG-2: Data migration is idempotent (can re-run safely)
- [ ] MIG-3: Rollback procedure documented and tested
- [ ] MIG-4: Breaking API changes behind feature flag or versioned endpoint
- [ ] MIG-5: Migration ordering respects foreign key dependencies
- [ ] MIG-6: No data loss scenarios (verify with dry-run)

## Language Registry

`compat_check` uses `qualityRules.compat` from each language's `spec.compat.mjs` fragment. Supports 5 languages: TypeScript, Go, Python, Rust, Java.

## Anti-Patterns
- Do NOT approve destructive schema changes (DROP TABLE/COLUMN) without rollback plan
- Do NOT assume ORM handles migration ordering — verify explicit ordering
- Do NOT ignore backward compatibility for "internal" APIs — consumers may exist
- Do NOT review outside the migration domain

## Rejection Codes
- **migration-unsafe**: Migration lacks rollback plan or is not idempotent
- **migration-breaking**: Breaking change without versioning or feature flag
