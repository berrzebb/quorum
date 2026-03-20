# Work Breakdown: Sample Track

## Principles

- Each item must be independently committable
- Completion criteria are closed by code + lint + tests
- Items with no stated prerequisite can be started in parallel

## Recommended order

1. `ST-1` First task
2. `ST-2` Second task (after ST-1)
3. `ST-3` Third task

## ST-1 First Task Title

- Goal:
  - One-line description of the boundary or structure this item fixes
- Prerequisites:
  - none (or another ST-N)
- Key files:
  - `src/domain/file.ts`
  - `tests/domain/file.test.ts`
- Completion criteria:
  - `npx eslint src/domain/file.ts` passes
  - Related tests pass

## ST-2 Second Task Title

- Goal:
  - Connect the next boundary based on what ST-1 fixed
- Prerequisites:
  - ST-1
- Key files:
  - `src/domain/another.ts`
- Completion criteria:
  - Feature works + lint + tests pass

## ST-3 Third Task Title

- Goal:
  - Close the full track with regression / integration tests
- Prerequisites:
  - ST-1, ST-2
- Key files:
  - `tests/domain/integration.test.ts`
- Completion criteria:
  - Full test suite passes
