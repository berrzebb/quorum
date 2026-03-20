---
name: cl-orch
description: "Shortcut for /quorum:orchestrator — distribute tasks, manage agents"
arguments:
  - name: task_id
    description: "Optional task ID to assign"
    required: false
---

Invoke the orchestrator skill: `/quorum:orchestrator {{ task_id }}`
