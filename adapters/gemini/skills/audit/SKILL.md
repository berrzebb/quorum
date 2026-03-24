---
name: quorum-audit
description: Run a quorum audit manually — reviews pending trigger_tag items in the watch file. Use when you want to trigger an audit, re-run a failed audit, or test the audit prompt.
---

Run the quorum consensus audit process. Execute:

```
quorum audit
```

If quorum CLI is not available, run directly:
```
node core/audit.mjs
```

After audit completes, check the result with `quorum status`.
