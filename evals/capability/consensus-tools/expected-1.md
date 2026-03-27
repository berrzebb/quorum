# Consensus Tools Expected Output Quality Standards

## 1. Correct Invocation Syntax

Tool invocations MUST use the correct MCP tool call format:

- `code_map` with `path` parameter set to the target directory (e.g., `src/auth/`)
- `blast_radius` with `files` parameter as an array of changed file paths
- Parameters must match the tool's JSON schema (no extra or missing required fields)

## 2. Parameter Accuracy

- `code_map` `path` parameter points to a valid directory, not a file
- `blast_radius` `files` lists all 4 changed files as an array of strings
- No fabricated parameter names (e.g., using `directory` instead of `path`)
- Optional parameters are only included when they add value

## 3. Interprets JSON Output Correctly

The skill must interpret JSON output correctly and extract relevant data:

- Parse the `code_map` JSON result to identify exports, imports, and function signatures in `src/auth/`
- Parse the `blast_radius` JSON result to identify direct dependents and transitive impact
- Calculate the blast radius ratio (affected files / total files) for trigger scoring
- Distinguish between direct imports and transitive dependencies

## 4. Tool Selection Rationale

- Explains WHY `code_map` is appropriate (structural discovery of exports/imports)
- Explains WHY `blast_radius` is appropriate (impact analysis for audit trigger)
- Mentions other potentially useful tools for this context (e.g., `dependency_graph` for full import graph, `audit_scan` for pre-validation)
- Does not use tools that are redundant or inapplicable

## 5. References Tool Documentation and Catalog

The skill references tool documentation or catalog for unfamiliar tools. Based on tool results, the output MUST:

- Classify the change as low/medium/high risk based on blast radius ratio
- Note if blast radius ratio > 0.1 (triggers additional audit scoring of up to +0.15)
- Identify any cross-layer impacts (e.g., middleware affecting route handlers)
- Recommend appropriate audit tier based on the combined tool evidence
