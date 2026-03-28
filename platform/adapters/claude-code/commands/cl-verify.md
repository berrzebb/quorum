---
name: cl-verify
description: "Shortcut for /quorum:verify — run done-criteria checks (CQ/T/CC/CL/S/I/FV/CV)"
arguments:
  - name: category
    description: "Optional: specific category (CQ, T, CC, CL, S, I, FV, CV)"
    required: false
---

Invoke the verify skill: `/quorum:verify {{ category }}`
