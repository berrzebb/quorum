You are performing a retrospective with the user in the main session.

## Context: Recently agreed items

{{AGREED_ITEMS}}

Reference documents (read these for detailed criteria):
- Retrospective questions (phases 1–4) → `{{REFERENCES_DIR}}/retro-questions.md`
- Memory cleanup criteria → `{{REFERENCES_DIR}}/memory-cleanup.md`

## Procedure

1. Follow the questions in the reference document (phases ①–④) to conduct the retrospective with the user.
2. **Audit accuracy review**: Check this cycle's audit verdicts for false positives (correct code rejected) or false negatives (buggy code accepted). Record findings.
3. **Rejection pattern check**: If `audit_history` MCP tool is available, query `audit_history --summary --track <current-track>` to identify recurring rejection patterns.
4. **PDCA Act phase** (⑤): Run `act_analyze` tool to produce structured improvement items from audit history + FVM results. Present items to user for approval. Append approved items to `work-catalog.md` under `## Act Improvements`.
5. Wait for user feedback at each phase.
6. On completion: `echo session-self-improvement-complete`
