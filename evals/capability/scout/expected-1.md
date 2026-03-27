# Scout Expected Output Quality Standards

## 1. Three RTM Types

The output MUST produce all 3 traceability matrices:

- **Forward RTM**: Requirement → Design → Implementation → Test (top-down)
- **Backward RTM**: Test → Implementation → Design → Requirement (bottom-up)
- **Bidirectional RTM**: Combined forward + backward with cross-references

Each RTM must be a table with clearly labeled columns and row identifiers.

## 2. Deterministic Tools First

The scout MUST invoke deterministic tools before applying LLM reasoning:

- `code_map` on target directories (`src/auth/`, `src/middleware/`, etc.) to discover existing code structure
- `dependency_graph` to map import relationships between target files
- Tool results must inform the RTM content (not fabricated from prompt alone)

## 3. Gap Report

The output MUST include a gap report identifying:

- Requirements without corresponding implementation (forward gaps)
- Implementation without corresponding requirements (backward gaps — orphan code)
- Requirements without corresponding test coverage
- Each gap has a severity (critical/warning) and recommended action

## 4. Completion Gate (5 Conditions)

The scout MUST verify 5 completion conditions before declaring done:

- All requirements (FR and NFR) have at least one RTM row
- All WB items are referenced in the RTM
- Gap report is written and reviewed
- Row counts match expected totals
- No orphan implementation files (every code file traces to a requirement)

## 5. Row Counts

- Each RTM table includes a summary row count (e.g., "Forward RTM: 6 rows")
- Row counts are consistent across Forward and Backward matrices
- Missing rows are explicitly listed in the gap report

## 6. 8-Phase Protocol Adherence

The output should follow the 8-phase RTM generation protocol:

- Phase 1: Scope identification
- Phase 2: Requirement enumeration
- Phase 3: Code structure discovery (tools)
- Phase 4: Forward traceability mapping
- Phase 5: Backward traceability mapping
- Phase 6: Bidirectional cross-reference
- Phase 7: Gap analysis
- Phase 8: Report generation with row counts
