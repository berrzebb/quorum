# Tool Inventory

26 deterministic analysis tools available via CLI. All tools run the same logic regardless of adapter — only the invocation method differs.

## Invocation

```bash
quorum tool <tool_name> [--param value] [--json]
```

Or directly: `quorum tool <tool_name> [--param value]`

Add `--json` to any command for structured JSON output.

## Tool Catalog

### Codebase Analysis (6)

| Tool | Purpose |
|------|---------|
| `code_map` | Symbol index — functions, classes, types with line ranges |
| `dependency_graph` | Import/export graph, cycle detection, connected components |
| `blast_radius` | Transitive dependents via reverse import BFS. Ratio > 0.1 = high impact |
| `audit_scan` | Pattern scan — `as any`, hardcoded values, console.log, type-safety |
| `coverage_map` | Per-file test coverage (stmt%, branch%) |
| `act_analyze` | PDCA Act phase — audit metrics → improvement items |

### Domain Scans (8)

Language-aware scans using `languages/{lang}/spec.{domain}.mjs` fragments. Auto-detect project languages (TypeScript, Go, Python, Rust, Java).

| Tool | Domain | Language Fragment |
|------|--------|-----------------|
| `perf_scan` | Performance (N+1, O(n²), sync I/O, bundle) | `spec.perf.mjs` |
| `a11y_scan` | Accessibility (labels, keyboard, ARIA) | `spec.a11y.mjs` (TS only) |
| `compat_check` | API compatibility (deprecated, CJS/ESM) | `spec.compat.mjs` |
| `i18n_validate` | Internationalization (hardcoded strings, key parity) | `i18nHardcodedRe` |
| `license_scan` | License compliance + secret detection | Package manifests |
| `infra_scan` | Infrastructure (Dockerfile, CI, docker-compose) | Config files |
| `observability_check` | Logging/metrics gaps (empty catch, console.log) | `spec.observability.mjs` |
| `doc_coverage` | Documentation completeness (JSDoc, docstrings) | `spec.doc.mjs` |

### RTM & FVM (4)

| Tool | Purpose |
|------|---------|
| `rtm_parse` | Parse RTM markdown → structured rows. Filter by req_id or status |
| `rtm_merge` | Merge worktree RTM into base RTM |
| `fvm_generate` | Generate FE×API×BE×Auth verification matrix |
| `fvm_validate` | Execute FVM rows against live server |

### Audit & Guide (2)

| Tool | Purpose |
|------|---------|
| `audit_history` | Query verdict history from SQLite. `--summary` for aggregate stats, `--json` for structured output |
| `ai_guide` | Synthesize code_map + dependency_graph + doc_coverage into onboarding guide |

### Skill & Track Management (2)

| Tool | Purpose |
|------|---------|
| `skill_sync` | Detect/fix mismatches between canonical skills and adapter wrappers. `--mode fix` auto-generates missing wrappers |
| `track_archive` | Archive completed track artifacts (PRD, DRM, WB, RTM, design, wave state) to `.claude/quorum/archive/` |

## Detailed References

For parameters, examples, and output format of each tool, see: `platform/skills/consensus-tools/references/`

## Error Handling

- Exit 0 = success (text to stdout, summary to stderr)
- Exit 1 = error (message to stderr)
- `--json` flag outputs structured JSON for programmatic use
