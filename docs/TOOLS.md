# quorum tools — Deterministic Analysis

Built-in tools for codebase analysis and pre-audit verification. All deterministic — no LLM involved.

---

## Usage

```bash
quorum tool <name> <path> [options]
quorum tool <name> --help                    # tool-specific help
quorum tool <name> <path> --json             # raw JSON output
```

---

## code_map

Symbol index — functions, classes, types, imports with line ranges.

```bash
quorum tool code_map src/
quorum tool code_map src/agent/ --filter fn,class
quorum tool code_map src/bus/ --format matrix
```

| Option | Description |
|--------|-------------|
| `--filter` | Symbol types: `fn`, `class`, `type`, `import`, `iface` |
| `--depth` | Max directory depth |
| `--format` | `detail` (default) or `matrix` |

---

## dependency_graph

Import/export DAG — connected components, topological sort, cycle detection.

```bash
quorum tool dependency_graph .
quorum tool dependency_graph src/ --depth 2
```

| Option | Description |
|--------|-------------|
| `--depth` | Max directory depth |
| `--extensions` | File extensions (default: `.ts,.mjs,.js`) |

---

## blast_radius

Transitive impact of changed files via BFS on reverse import graph.

```bash
quorum tool blast_radius --changed_files '["platform/core/bridge.mjs"]'
quorum tool blast_radius --changed_files '["src/api.ts"]' --max_depth 5
```

| Option | Description |
|--------|-------------|
| `--changed_files` | JSON array of changed file paths |
| `--max_depth` | BFS depth limit (default: 10) |

---

## audit_scan

Pattern scanner — type-safety issues, hardcoded values, console statements.

```bash
quorum tool audit_scan src/
quorum tool audit_scan src/ --pattern type-safety
```

| Option | Description |
|--------|-------------|
| `--pattern` | `all`, `type-safety`, `hardcoded`, `console` |

---

## coverage_map

Per-file test coverage from vitest/jest JSON reports.

```bash
quorum tool coverage_map src/
```

---

## perf_scan

Performance anti-patterns — O(n²) loops, sync I/O, busy loops, unbounded queries.

```bash
quorum tool perf_scan src/
```

---

## a11y_scan

JSX/TSX accessibility — missing alt, non-keyboard onClick, aria issues.

```bash
quorum tool a11y_scan src/components/
```

---

## compat_check

Compatibility — @deprecated, @breaking, CJS/ESM mixing, wildcard deps.

```bash
quorum tool compat_check src/
```

---

## license_scan

License risk + PII patterns — copyleft deps, hardcoded secrets.

```bash
quorum tool license_scan .
```

---

## infra_scan

Infrastructure security — Dockerfile, CI/CD, docker-compose, nginx.

```bash
quorum tool infra_scan .
```

---

## observability_check

Observability gaps — empty catch blocks, console.log, missing structured logging.

```bash
quorum tool observability_check src/
```

---

## i18n_validate

i18n key validation — cross-locale key sync, missing/extra keys.

```bash
quorum tool i18n_validate locales/
```

---

## doc_coverage

Documentation-code alignment — undocumented exports, per-file JSDoc coverage.

```bash
quorum tool doc_coverage src/
```

---

## rtm_parse

Parse RTM markdown into structured rows.

```bash
quorum tool rtm_parse docs/rtm.md
quorum tool rtm_parse docs/rtm.md --matrix forward
quorum tool rtm_parse docs/rtm.md --req_id EV-1
```

| Option | Description |
|--------|-------------|
| `--matrix` | `forward`, `backward`, `bidirectional` |
| `--req_id` | Filter by requirement ID |
| `--status` | Filter: `open`, `verified`, `wip` |

---

## rtm_merge

Merge worktree RTMs into a base RTM with conflict detection.

```bash
quorum tool rtm_merge --base docs/rtm.md --updates '["wt1/rtm.md","wt2/rtm.md"]'
```

---

## fvm_generate

Feature Verification Matrix — FE routes × API × BE endpoints × access policies.

```bash
quorum tool fvm_generate /path/to/project
quorum tool fvm_generate /path/to/project --format mismatches
```

| Option | Description |
|--------|-------------|
| `--format` | `full`, `mismatches`, `matrix` |

---

## fvm_validate

Execute FVM rows against a live server.

```bash
quorum tool fvm_validate --fvm_path docs/fvm.md --base_url http://localhost:3000 \
  --credentials '{"admin":{"token":"abc"}}'
```

| Option | Description |
|--------|-------------|
| `--fvm_path` | FVM markdown file |
| `--base_url` | Server URL |
| `--credentials` | JSON: role → {username, password} or {token} |
| `--filter_role` | Test only this role |
| `--filter_route` | Test only this route |

---

## audit_history

Query persistent audit verdict history.

```bash
quorum tool audit_history --summary
quorum tool audit_history --track evaluation-pipeline
quorum tool audit_history --code CQ --since 2026-03-15T00:00:00Z
```

| Option | Description |
|--------|-------------|
| `--track` | Filter by track name |
| `--code` | Filter by rejection code prefix |
| `--since` | ISO timestamp filter |
| `--summary` | Aggregated summary |

---

## act_analyze

Derive improvement items from audit history + FVM results.

```bash
quorum tool act_analyze
```

---

## blueprint_lint

Check source code against Blueprint naming conventions from design documents.

```bash
quorum tool blueprint_lint
quorum tool blueprint_lint --design_dir docs/design --path src/
```

---

## audit_submit

Submit evidence to SQLite EventStore.

```bash
quorum tool audit_submit --content "## [REVIEW_NEEDED] Auth module\n### Claim\n..."
```

---

## agent_comm

Inter-agent communication for parallel implementation.

```bash
quorum tool agent_comm --action post --agent_id impl-1 --to_agent impl-2 --question "Schema ready?"
quorum tool agent_comm --action poll --agent_id impl-1
quorum tool agent_comm --action respond --agent_id impl-1 --query_id <id> --answer "Done."
```

---

## ai_guide

AI agent guide queries.

```bash
quorum tool ai_guide --topic evidence
quorum tool ai_guide --topic roles
```

---

## contract_drift

Detect contract drift: type/interface re-declarations, signature mismatches, and missing members between contract directories and implementations. Uses AST program mode.

```bash
quorum tool contract_drift
quorum tool contract_drift --contract_dirs types,interfaces
```

---

## skill_sync

Detect and fix mismatches between canonical skills (`platform/skills/`) and adapter wrappers (`platform/adapters/*/skills/`). Reports missing wrappers, stale references, and count discrepancies.

```bash
quorum tool skill_sync
quorum tool skill_sync --fix
```

---

## track_archive

Archive completed track planning artifacts to an archive directory. Moves WB, PRD, design, and RTM files.

```bash
quorum tool track_archive --track mytrack
quorum tool track_archive --track mytrack --dry_run
```

---

## Verification Pipeline

```bash
quorum verify              # all checks
quorum verify CQ           # eslint
quorum verify T            # tsc --noEmit
quorum verify TEST         # npm test
quorum verify SCOPE        # git diff vs evidence match
quorum verify SEC          # OWASP security scan
quorum verify LEAK         # secret detection
quorum verify DEP          # dependency vulnerabilities
```

---

## scan-ignore

Add `// scan-ignore` to any source line to suppress pattern scan findings on that line.
