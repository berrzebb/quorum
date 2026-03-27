# Expected: Gap Analysis Pipeline

## Procedure Steps

1. Read all design documents from `plans/auth-refactor/design/`
2. Extract verifiable facts:
   - From Spec: function signatures, error codes, validation rules
   - From Blueprint: module names, dependencies, naming conventions
   - From Domain Model: entity names, fields, relationships, state transitions
3. Run `quorum tool code_map --path src/auth/` for codebase structure
4. Run `quorum tool dependency_graph --path src/auth/` for import graph
5. Run `quorum tool blueprint_lint` for naming convention compliance
6. Compare each extracted fact against implementation
7. Classify each fact: Match, Partial, Missing, or Extra
8. Calculate Match Rate
9. Generate structured gap report with:
   - Summary table (counts per category)
   - Detail per gap (design reference + code location + impact)
   - Recommendations
10. Report is read-only — no files modified
