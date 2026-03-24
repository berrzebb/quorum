---
name: quorum-verify
description: Run all done-criteria checks (CQ/T/CC/CL/S/I/FV/CV) and produce a pass/fail verification report. Use after implementing code, before submitting evidence to the quorum audit.
---

Run the quorum verification pipeline to check code quality before submitting evidence.

```
quorum verify
```

Individual checks:
```
quorum verify CQ    # Code Quality (eslint)
quorum verify SEC   # Security (OWASP patterns)
quorum verify LEAK  # Secret leak detection
quorum verify DEP   # Dependency vulnerabilities
quorum verify SCOPE # Diff vs evidence match
```

All checks must pass before evidence submission. Fix any failures and re-run.
