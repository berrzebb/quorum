# Expected: Forward + Backward Trace

## Procedure Steps

1. Receive structured requirements table (3 WBs, 4 target files)
2. Group files by directory: src/auth/ (3 files), src/api/ (1 file)
3. Forward Scan — batch by directory:
   - Run `quorum tool code_map --path src/auth/` → check existence of middleware.ts, session.ts, rbac.ts
   - Run `quorum tool code_map --path src/api/` → check existence of routes.ts
   - Run `quorum tool dependency_graph --path src/auth/` → verify import chains
   - Run `quorum tool coverage_map --path src/auth/` → per-file coverage
   - Run `quorum tool code_map --path tests/` → discover matching test files
4. Build Forward RTM rows: one row per Req × File
5. Backward Scan:
   - Run `quorum tool dependency_graph --path tests/` → trace test imports to source
   - Map each test to its source requirement
   - Flag unmapped tests as orphan
6. Build Backward RTM rows
7. Output both tables
8. Tool failures recorded as infra_failure in affected rows
