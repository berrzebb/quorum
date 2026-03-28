# Doc-Sync Eval Prompt

Sync documentation after adding 3 new MCP tools and updating hook counts.

## Context

The following changes were made to the codebase:

1. Added 3 new MCP tools to `platform/core/tools/`:
   - `contract_drift` — detects interface/implementation drift
   - `coverage_map` — test coverage visualization
   - `license_scan` — dependency license compliance check

2. Updated hook registrations:
   - `platform/adapters/claude-code/hooks/hooks.json`: 22 → 24 hooks (added ConfigChange, Elicitation)
   - `platform/adapters/gemini/hooks/hooks.json`: 11 → 12 hooks (added BeforeModel)
   - `platform/adapters/codex/hooks/hooks.json`: 5 → 6 hooks (added AfterToolUse)

3. Test count changed: 1077 → 1112 tests

## Documentation Files to Sync

- `CLAUDE.md` (L3 design — Module Map, tool counts, test counts)
- `README.md` (L1 public — feature overview, tool count)
- `docs/RTM.md` (L2 RTM — tool traceability matrix)
- `docs/ARCHITECTURE.md` (L3 design — hook pipeline description)

## Instructions

Run the doc-sync protocol: extract facts from code, compare against documentation values, build a mismatch report, and apply fixes.
