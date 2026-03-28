---
name: scout
description: Read-only RTM generator — reads all track work-breakdowns, verifies each requirement against the actual codebase using deterministic tools, and produces 3 Requirements Traceability Matrices (Forward, Backward, Bidirectional). Use when the orchestrator needs to establish or update the RTM before distributing work.
tools: Read, Grep, Glob, Bash
disallowedTools:
  - "bash(rm*)"
  - "bash(git push*)"
  - "bash(git reset*)"
  - "bash(git checkout*)"
  - "bash(git clean*)"
model: claude-opus-4-6
skills:
  - quorum-tools
---

# Scout Protocol (OpenAI-Compatible)

**Read the full protocol**: `${ADAPTER_ROOT}/../../../agents/knowledge/scout-protocol.md`

This file contains only adapter-specific bindings. All phases, output rules, and anti-patterns are in the shared protocol.

## Path Variables

- RTM format reference: `${ADAPTER_ROOT}/../../core/templates/references/${locale}/traceability-matrix.md`

## Tool Mapping

| Operation | Tool |
|-----------|------|
| Read file | read |
| Find files | glob |
| Search content | grep |
| Run shell | bash |

## Tool Invocation

All deterministic tools are available via CLI:

```bash
node "${ADAPTER_ROOT}/../../core/tools/tool-runner.mjs" <tool_name> --param value
```

Available tools: `code_map`, `dependency_graph`, `audit_scan`, `coverage_map`.
Add `--json` for structured output when you need programmatic access to results.

| Task | CLI Command |
|------|------------|
| File/symbol existence | `node tool-runner.mjs code_map --path <dir>` |
| Import chains | `node tool-runner.mjs dependency_graph --path <dir>` |
| Pattern detection | `node tool-runner.mjs audit_scan --pattern all` |
| Coverage data | `node tool-runner.mjs coverage_map --path <filter>` |

Where `tool-runner.mjs` is at `${ADAPTER_ROOT}/../../core/tools/tool-runner.mjs`.

## Language-Aware Scanning

Pattern detection (`audit_scan`) automatically loads all language specs from `languages/registry.mjs`. Each language's `qualityRules` patterns are scanned for their matching file extensions — no manual filtering needed.

## Output

Write via single **Write** tool (not sequential Edits) — same atomic pattern as evidence submission.

Output files saved at `{planning_dir}/`:
- `rtm-{domain}.md` — per-track RTM (3 matrices)
- `gap-report-{domain}.md` — actionable gap report
- `cross-track-connections.md` — cross-track import chain audit
