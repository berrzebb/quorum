# Orchestrator Eval Scenario

Execute a track with the following work breakdown:

## Context

- Track: `user-auth`
- Provider: `claude`
- Concurrency: 2
- Work items:
  - WB-1.1: Setup auth middleware (Phase 1, Size: S, no dependencies)
  - WB-1.2: Login endpoint (Phase 1, Size: M, depends on WB-1.1)
  - WB-1.3: JWT token service (Phase 1, Size: S, no dependencies)
  - WB-2.1: Protected routes (Phase 2, Size: M, depends on WB-1.1, WB-1.2)

## Task

Execute `quorum orchestrate run user-auth --provider claude --concurrency 2`
