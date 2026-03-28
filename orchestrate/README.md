# orchestrate/

This directory has been removed as part of the platform consolidation (PLT track).

All orchestration source code now lives in `platform/orchestrate/`.

Sub-layers:
- `platform/orchestrate/planning/` -- Legislation/blueprint generation
- `platform/orchestrate/execution/` -- Model routing, agent sessions, audit/fixer loops
- `platform/orchestrate/governance/` -- RTM, phase gates, lifecycle, fitness, scope
- `platform/orchestrate/state/` -- State contracts + filesystem stores
- `platform/orchestrate/core/` -- Provider binary, mux, prompt I/O
