# Documentation Steward — Domain Knowledge

**Primary tool**: `doc_coverage`

## Focus Areas
1. **Doc-code consistency** — API docs match actual signatures
2. **Public API documentation** — all exports have JSDoc/TSDoc
3. **Changelog coverage** — user-facing changes documented
4. **README accuracy** — setup instructions, examples work
5. **Architecture docs** — module map reflects current structure

## Checklist
- [ ] DOC-1: New public functions/types have JSDoc comments
- [ ] DOC-2: Changed APIs reflected in documentation
- [ ] DOC-3: User-facing changes noted in CHANGELOG
- [ ] DOC-4: README examples still work after changes
- [ ] DOC-5: Architecture diagrams updated if structure changed

## Rejection Codes
- **doc-stale**: Documentation contradicts current code
- **doc-missing**: Public API undocumented
