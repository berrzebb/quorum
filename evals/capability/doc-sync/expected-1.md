# Doc-Sync Expected Output Quality Standards

## 1. Fact Extraction Accuracy

The doc-sync output MUST extract concrete facts from source code:

- **Tool count**: Counts MCP tools in `platform/core/tools/` directory (should reflect 22 + 3 = 25)
- **Hook counts per adapter**: Reads each adapter's `hooks.json` and counts registrations
- **Test count**: Parses test runner output or test file count
- Values must be derived from code inspection, not from documentation (code is source of truth)

## 2. Comparison Table

Output MUST include a structured comparison table with columns:

- Fact Name | Code Value | Doc Value | File | Status (match/mismatch)
- Every mismatch row is flagged for correction
- Table covers all numeric and structural facts across all target documents

## 3. Multi-Adapter Awareness

- Separately counts hooks for Claude Code (24), Gemini (12), and Codex (6)
- Does not conflate adapter-specific counts
- Updates each adapter's documentation section independently
- Recognizes adapter-specific hook types (e.g., Gemini has AfterAgent/BeforeModel, Codex has SessionStart)

## 4. Three-Layer Coverage

All 3 documentation layers MUST be checked:

- **L1 Public** (`README.md`): User-facing feature counts and descriptions
- **L2 RTM** (`docs/RTM.md`): Traceability rows for new tools
- **L3 Design** (`CLAUDE.md`, `docs/ARCHITECTURE.md`): Internal module maps, hook pipeline details

## 5. Section Parity

- Detects when a section exists in one doc but is missing in a related doc
- Example: New tool listed in CLAUDE.md Module Map but missing from README feature list
- Reports parity gaps alongside numeric mismatches

## 6. Fix Application

- Each mismatch has a concrete fix (old value → new value with file path and line reference)
- Fixes are applied atomically (all or nothing per document)
- No unrelated changes introduced during sync
