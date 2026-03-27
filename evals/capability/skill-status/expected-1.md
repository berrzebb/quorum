# Expected: Skill Inventory Report

## Quality Standards

1. **Complete Scan**: All canonical skills under `skills/*/SKILL.md` are discovered
2. **Full Cross-Reference**: Every canonical skill is checked against all 4 adapters (claude-code, gemini, codex, openai-compatible) and eval directories
3. **Accurate Detection**: Missing wrappers are correctly identified with specific adapter names
4. **Mismatch Detection**: Description differences between canonical and adapter wrappers are flagged
5. **Conflict Detection**: Skills with overlapping trigger keywords are identified
6. **Structured Output**: Report includes compatibility matrix table, issue list with types, and summary statistics
7. **Eval Coverage**: Percentage of skills with eval definitions is reported
8. **Read-Only**: No files are modified during the scan
