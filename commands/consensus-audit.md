---
name: cl-audit
description: "Shortcut for /quorum:audit"
arguments:
  - name: options
    description: "Flags: --dry-run, --no-resume, --auto-fix, --model <name>"
    required: false
---

Invoke the audit skill: `/quorum:audit {{ options }}`
