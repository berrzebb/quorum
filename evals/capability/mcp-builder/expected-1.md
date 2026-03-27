# Expected Quality Standards — MCP Tool Creation

1. **Naming Convention**: The tool function must follow the `toolXxx` naming convention used by all existing MCP tools in `core/tools/`. For this tool, the function should be named `toolTypeCoverage`. The exported name must match the registration key.

2. **Return Format**: The tool must return an object matching the standard MCP tool response format: `{ text: string, summary: string, json?: object, error?: string }`. The `text` field contains the human-readable report, `summary` is a one-line overview, `json` holds structured data for programmatic consumption, and `error` is set only on failure.

3. **TOOL_NAMES Registration**: The tool must be registered in `adapters/shared/tool-names.mjs` with mappings for all 3 adapters (claude-code, gemini, codex). The canonical name `type_coverage` must map to each adapter's naming convention.

4. **Error Handling**: The tool must wrap its core logic in try/catch and return meaningful error messages rather than throwing unhandled exceptions. Errors should include the file path that failed and the reason. The tool must follow the fail-open pattern (return partial results rather than crashing).

5. **Parameter Validation**: All input parameters must be validated before use. Required parameters (e.g., `filePath` or `directory`) must be checked for presence and type. Invalid inputs should return an error response, not throw. Optional parameters should have documented defaults.

6. **TypeScript AST Integration**: Since this tool measures type annotation coverage, it should use the existing AST infrastructure (`providers/ast-analyzer.ts` or `core/tools/ast-bridge.mjs`) rather than regex-only parsing. It should count: typed function parameters, typed return values, typed variable declarations, and interface/type alias usage.

7. **Coverage Metrics**: The JSON output should include per-file metrics: total declarations, typed declarations, coverage percentage, and a list of untyped locations (line number + identifier name). The summary should report the overall coverage percentage.

8. **Scan-Ignore Support**: The tool should respect the `// scan-ignore` pragma. Lines or declarations marked with scan-ignore should be excluded from the untyped count, consistent with the pattern used by `perf_scan` and other hybrid tools.
