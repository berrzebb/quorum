# quorum Command Reference

> Every CLI command with syntax, flags, and examples. For tool-specific reference, see [Tool Reference](TOOLS.md). For workflow walkthroughs, see [User Guide](USER-GUIDE.md).

---

## Setup & Status

```bash
quorum setup                             # Initialize project (copies config, templates)
quorum status                            # Gate status (audit, retro, quality, parliament)
quorum daemon                            # TUI dashboard (real-time monitoring)
```

---

## Parliament

Legislative deliberation for strategic decisions.

```bash
quorum parliament "topic"                # Basic deliberation → CPS
quorum parliament --rounds 3 "topic"     # Multi-round convergence
quorum parliament --mux "topic"          # Daemon-observable sessions
quorum parliament --history              # Review past sessions
quorum parliament --detail <id>          # Session detail
quorum parliament --resume <id>          # Continue deliberation
quorum parliament --force "topic"        # Bypass enforcement gates
```

| Flag | Description |
|------|-------------|
| `--rounds N` | Max deliberation rounds (default: config value) |
| `--mux` | Spawn LLM sessions as mux panes (daemon-visible) |
| `--committee` | Route to specific standing committee |
| `--advocate` | Override advocate provider |
| `--devil` | Override devil's advocate provider |
| `--judge` | Override judge provider |
| `--testimony` | Include implementer testimony |
| `--resume <id>` | Resume from checkpoint |
| `--force` | Bypass enforcement gates |

---

## Orchestration

Plan and execute work breakdowns in waves.

```bash
quorum orchestrate plan <track>                      # Interactive planner (Socratic)
quorum orchestrate plan <track> --provider claude     # Specify provider
quorum orchestrate run <track>                        # Wave-based execution
quorum orchestrate run <track> --provider claude      # Specify provider
quorum orchestrate run <track> --resume               # Resume from checkpoint
quorum orchestrate run <track> --concurrency 5        # Parallel agents per wave
```

| Flag | Description |
|------|-------------|
| `--provider` | LLM provider (claude, openai, codex, gemini) |
| `--concurrency N` | Max parallel agents per wave (default: 3) |
| `--resume` | Load saved state, skip completed waves |
| `--model` | Override model selection |

---

## Verification

Run deterministic quality checks. Language-specific checks auto-detect the project type.

```bash
quorum verify                            # All checks
quorum verify CQ                         # Code quality (linter)
quorum verify T                          # Type check (compiler)
quorum verify TEST                       # Tests (test runner)
quorum verify SCOPE                      # Scope match (git diff vs evidence)
quorum verify SEC                        # OWASP security scan
quorum verify LEAK                       # Secret detection
quorum verify DEP                        # Dependency vulnerabilities
```

| Check | JS/TS | Go | Python | Rust | Java |
|-------|-------|-----|--------|------|------|
| CQ | eslint | golangci-lint | flake8/ruff | clippy | checkstyle |
| T | tsc --noEmit | go vet | mypy | cargo check | javac |
| TEST | npm test | go test | pytest | cargo test | mvn test |
| DEP | npm audit | govulncheck | pip-audit | cargo audit | mvn dependency-check |

> Currently implemented: JS/TS. Other languages use pattern scanning via `languages/` registry.

---

## Tools

Run deterministic MCP analysis tools.

```bash
quorum tool <name> [path] [options]      # Run tool
quorum tool <name> --help                # Tool-specific help
quorum tool <name> [path] --json         # Raw JSON output
```

See [Tool Reference](TOOLS.md) for all 30 tools.

---

## Vault Management

Knowledge vault with Obsidian integration, session search, and graph analysis.

```bash
quorum vault status                          # DB stats (sessions, turns, embeddings)
quorum vault ingest --auto                   # Auto-ingest Claude/Codex/Gemini sessions
quorum vault ingest <path>                   # Ingest single file or directory
quorum vault search <query>                  # FTS5 keyword search
quorum vault embed                           # Generate BGE-M3 embeddings for unembedded turns
quorum vault graph                           # Graph analysis → GRAPH_REPORT.md
quorum vault schema                          # Build schema/AGENTS.md + wiki meta-files
```

| Flag | Description |
|------|-------------|
| `--auto` | (ingest) Scan default session locations |

Environment: `QUORUM_VAULT_PATH` overrides default vault location (`~/.quorum/vault`).

---

## Steering

Switch gate enforcement profile.

```bash
quorum steer                                 # Show current profile
quorum steer strict                          # Switch to strict mode
quorum steer balanced                        # Switch to balanced (default)
quorum steer fast                            # Switch to fast mode
quorum steer prototype                       # Switch to prototype mode
```

---

## Utility

```bash
quorum plan                              # List work breakdowns
quorum ask <provider> "prompt"           # Direct provider query
quorum migrate                           # Import from consensus-loop
quorum migrate --dry-run                 # Preview migration
```

---

## Skill Shortcuts

| Shortcut | Skill | Description |
|----------|-------|-------------|
| `/quorum:cl-orch` | orchestrator | Distribute tasks, manage agents |
| `/quorum:cl-plan` | planner | Design PRD, tracks, work breakdowns |
| `/quorum:cl-verify` | verify-implementation | Run done-criteria checks |
| `/quorum:cl-docs` | doc-sync | Extract code facts, fix doc mismatches |
| `/quorum:cl-tools` | consensus-tools | Run analysis tools |
| `/quorum:cl-retro` | retrospect | Extract learnings, manage memories |
| `/quorum:cl-merge` | merge-worktree | Squash-merge worktree branch |
| `/quorum:cl-guide` | guide | Evidence writing guide |
| `/quorum:consensus-audit` | audit | Run manual audit |
| `/quorum:consensus-status` | status | Show gate status |
