---
name: quorum-guide
description: Guide for writing evidence packages for the quorum watch file. Use when preparing code review submissions, structuring feedback evidence, or addressing audit rejections.
---

Help the user write a proper evidence package for the quorum audit process.

The evidence must be written in the watch file (configured in config.json, typically `docs/feedback/claude.md`) and must include these required sections:

```markdown
## [Item Name] [GPT미검증]

### Claim
What was done and why.

### Changed Files
- `path/to/file1.ts`
- `path/to/file2.ts`

### Test Command
```bash
npm test
```

### Test Result
All 28 tests passed. No regressions.

### Residual Risk
None / Description of remaining risks.
```

Key rules:
- Never self-approve (use trigger_tag, not agree_tag)
- Test commands must be specific (no globs)
- Test results must include actual output
- Changed files must exist and match git diff
