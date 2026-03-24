# quorum tools — Deterministic Analysis & Verification

Built-in tools for codebase analysis and pre-audit verification. All deterministic — no LLM involved.

**Principle: facts first, inference second.** Run deterministic tools before LLM reasoning.

---

## Usage

```bash
quorum tool <name> <path> [options]
quorum tool <name> --path <path> [options]   # explicit form
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
quorum tool code_map src/api.ts --json
```

| Option | Description |
|--------|-------------|
| `--path` | Directory or file to scan |
| `--filter` | Symbol types: `fn`, `class`, `type`, `import`, `iface` |
| `--depth` | Max directory depth |
| `--format` | `detail` (default) or `matrix` |

---

## dependency_graph

Import/export DAG — connected components, topological sort, cycle detection.

```bash
quorum tool dependency_graph .
quorum tool dependency_graph src/ --depth 2
quorum tool dependency_graph src/ --extensions .ts,.mjs --json
```

| Option | Description |
|--------|-------------|
| `--path` | Directory to scan |
| `--depth` | Max directory depth |
| `--extensions` | File extensions to include (default: `.ts,.mjs,.js`) |

---

## audit_scan

Pattern scanner — detects type-safety issues, hardcoded values, console statements.

```bash
quorum tool audit_scan .
quorum tool audit_scan src/ --pattern type-safety
quorum tool audit_scan src/config/ --pattern hardcoded
```

| Option | Description |
|--------|-------------|
| `--path` | Directory to scan |
| `--pattern` | `all` (default), `type-safety`, `hardcoded`, `console` |

---

## coverage_map

Per-file test coverage from vitest JSON reports.

```bash
quorum tool coverage_map
quorum tool coverage_map src/agent/
quorum tool coverage_map --coverage_dir coverage-report/
```

| Option | Description |
|--------|-------------|
| `--path` | Filter to specific directory |
| `--coverage_dir` | Coverage report directory (default: `coverage/`) |

---

## rtm_parse

Parse Requirements Traceability Matrix (RTM) markdown into structured rows.

```bash
quorum tool rtm_parse docs/rtm.md
quorum tool rtm_parse docs/rtm.md --matrix forward
quorum tool rtm_parse docs/rtm.md --req_id EV-1
quorum tool rtm_parse docs/rtm.md --status open
```

| Option | Description |
|--------|-------------|
| `--path` | RTM markdown file |
| `--matrix` | `forward`, `backward`, or `bidirectional` |
| `--req_id` | Filter by requirement ID |
| `--status` | Filter by status (`open`, `verified`, `wip`) |

---

## rtm_merge

Merge multiple worktree RTMs into a base RTM with conflict detection.

```bash
quorum tool rtm_merge --base docs/rtm.md --updates '["wt1/rtm.md","wt2/rtm.md"]'
```

| Option | Description |
|--------|-------------|
| `--base` | Base RTM file |
| `--updates` | JSON array of worktree RTM paths |

---

## audit_history

Query the persistent audit verdict history log.

```bash
quorum tool audit_history
quorum tool audit_history --summary
quorum tool audit_history --track evaluation-pipeline
quorum tool audit_history --code CQ --since 2026-03-15T00:00:00Z
```

| Option | Description |
|--------|-------------|
| `--path` | JSONL history file (default: `.claude/audit-history.jsonl`) |
| `--track` | Filter by track name |
| `--code` | Filter by rejection code prefix |
| `--since` | ISO timestamp filter |
| `--summary` | Show aggregated summary |

---

## fvm_generate

Generate Feature Verification Matrix — FE routes × API calls × BE endpoints × access policies.

```bash
quorum tool fvm_generate /path/to/project
quorum tool fvm_generate /path/to/project --format mismatches
quorum tool fvm_generate /path/to/project --format matrix --json
```

| Option | Description |
|--------|-------------|
| `--path` | Project root directory |
| `--format` | `full` (default), `mismatches`, `matrix` |

---

## fvm_validate

Execute FVM rows against a live server — verify that access policies match expectations.

```bash
quorum tool fvm_validate \
  --fvm_path docs/fvm.md \
  --base_url http://localhost:3000 \
  --credentials '{"admin":{"username":"admin","password":"pass"}}'

quorum tool fvm_validate \
  --fvm_path docs/fvm.md \
  --base_url http://localhost:3000 \
  --credentials '{"admin":{"token":"abc"}}' \
  --filter_role admin \
  --filter_route /api/users
```

| Option | Description |
|--------|-------------|
| `--fvm_path` | FVM markdown file |
| `--base_url` | Server URL to test against |
| `--credentials` | JSON: role → {username, password} or {token} |
| `--filter_role` | Test only this role |
| `--filter_route` | Test only this route |
| `--timeout_ms` | Request timeout (default: 5000) |

---

## perf_scan

Performance anti-pattern detection — O(n²) loops, sync I/O, busy loops, unbounded queries.

```bash
quorum tool perf_scan src/
quorum tool perf_scan core/tools/
```

| Option | Description |
|--------|-------------|
| `--path` | Directory or file to scan |

> Add `// scan-ignore` to any source line to suppress findings on that line. Used for self-referential false positives in pattern definition files.

---

## a11y_scan

JSX/TSX accessibility anti-patterns — missing `<img>` alt, non-keyboard onClick, aria issues.

```bash
quorum tool a11y_scan src/components/
```

| Option | Description |
|--------|-------------|
| `--path` | JSX/TSX file or directory |

---

## compat_check

Compatibility check — @deprecated, @breaking, CJS/ESM mixing, wildcard dependencies.

```bash
quorum tool compat_check src/
```

| Option | Description |
|--------|-------------|
| `--path` | Directory or file to scan |

---

## license_scan

License risk + PII patterns — copyleft deps, hardcoded secrets, SSN/email patterns.

```bash
quorum tool license_scan .
```

| Option | Description |
|--------|-------------|
| `--path` | Project root |

---

## infra_scan

Infrastructure security — Dockerfile, CI/CD, docker-compose, nginx config.

```bash
quorum tool infra_scan .
```

| Option | Description |
|--------|-------------|
| `--path` | Project root |

---

## observability_check

Observability gaps — empty catch blocks, console.log, missing structured logging.

```bash
quorum tool observability_check src/
```

| Option | Description |
|--------|-------------|
| `--path` | Directory or file to scan |

---

## i18n_validate

i18n key validation — cross-locale key sync, missing/extra key detection.

```bash
quorum tool i18n_validate locales/
```

| Option | Description |
|--------|-------------|
| `--path` | Locale directory |

---

## doc_coverage

Documentation-code alignment — undocumented exports, per-file JSDoc coverage.

```bash
quorum tool doc_coverage src/
```

| Option | Description |
|--------|-------------|
| `--path` | Directory to scan |

---

## ai_guide

AI agent guide queries — roles, protocols, document formats.

```bash
quorum tool ai_guide --topic evidence
quorum tool ai_guide --topic roles
```

| Option | Description |
|--------|-------------|
| `--topic` | Query topic (roles, evidence, tools, planner, etc.) |

---

## act_analyze

PDCA Act analysis — derive improvement items from audit history + FVM results.

```bash
quorum tool act_analyze
quorum tool act_analyze --history .claude/audit-history.jsonl
```

| Option | Description |
|--------|-------------|
| `--history` | Audit history JSONL file |
| `--fvm_results_path` | FVM validation results file |

---

## scan-ignore pragma

Tools based on `runPatternScan` (perf_scan, a11y_scan, compat_check, infra_scan, observability_check) recognize inline `// scan-ignore` comments. Lines with this annotation are excluded from pattern matching.

```javascript
{ re: /while\s*\(\s*true\s*\)/m, ... }, // scan-ignore: prevents self-referential match
```

---

## Verification Pipeline

`quorum verify` runs all checks in sequence. Each check is deterministic.

```bash
quorum verify              # run all checks
quorum verify CQ           # code quality only (eslint)
quorum verify T            # typescript only (tsc --noEmit)
quorum verify TEST         # tests only (npm test)
quorum verify SCOPE        # scope match (git diff vs evidence)
quorum verify SEC          # OWASP security scan (10 patterns, semgrep if available)
quorum verify LEAK         # secret detection (gitleaks if available, built-in fallback)
quorum verify DEP          # dependency vulnerabilities (npm audit)
```

### Security Scan (SEC)

OWASP Top 10 pattern detection. Uses semgrep if installed, falls back to built-in regex.

| ID | Pattern | Severity |
|----|---------|----------|
| SEC-01 | SSRF (dynamic URL in fetch/http) | Critical |
| SEC-02 | SQL Injection (string interpolation in queries) | Critical |
| SEC-03 | XSS (innerHTML, dangerouslySetInnerHTML) | High |
| SEC-04 | Path Traversal (../ in file operations) | Critical |
| SEC-05 | Hardcoded Secrets (password/token/key assignments) | High |
| SEC-06 | Insecure Deserialization (JSON.parse on untrusted input) | High |
| SEC-07 | Command Injection (dynamic exec/spawn) | Critical |
| SEC-08 | Missing Auth (route handler without middleware) | Medium |
| SEC-09 | Eval Usage (eval, new Function) | Critical |
| SEC-10 | Sensitive Data Logging (console.log with credentials) | Medium |

### Secret Detection (LEAK)

Scans git-staged files for leaked credentials. Language-agnostic.

Detected patterns: AWS keys (AKIA...), GitHub tokens (ghp_...), OpenAI keys (sk-...), private keys (-----BEGIN), JWTs (eyJ...).

If `gitleaks` is installed, delegates to it for deeper git history scanning.

### Dependency Audit (DEP)

Runs `npm audit` and reports critical/high vulnerabilities. Warnings don't block — only critical findings fail the check.

### Scope Match (SCOPE)

Compares `git diff --name-only` against the evidence's `### Changed Files` section. Catches:
- Files in diff but not documented in evidence (undocumented changes)
- Files in evidence but not in diff (claimed but unchanged)
