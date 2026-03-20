# quorum

[![npm](https://img.shields.io/npm/v/quorum-audit)](https://www.npmjs.com/package/quorum-audit)
[![CI](https://github.com/berrzebb/quorum/actions/workflows/ci.yml/badge.svg)](https://github.com/berrzebb/quorum/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22-brightgreen)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue)](https://www.typescriptlang.org)

Cross-model audit gate with structural enforcement. One model cannot approve its own code.

[한국어](README.ko.md)

```
edit → audit → agree → retro → commit
```

<p align="center">
  <img src="assets/quorum-plan.png" width="600" alt="quorum plan — track progress with RTM status">
</p>

## What it does

quorum enforces a consensus protocol between AI agents. When code is written, an independent auditor reviews the evidence. If rejected, the author must fix and resubmit. The cycle repeats until consensus is reached — only then can the code be committed.

The key principle: **no single model can both write and approve code.** This is the "quorum" — a minimum number of independent voices required for a decision.

## Installation

### Standalone (any AI tool)

quorum works without any IDE plugin. Just the CLI.

```bash
npm install -g quorum-audit    # global install
# or
npx quorum-audit setup         # one-shot without install

cd your-project
quorum setup                   # creates config + MCP server registration
quorum daemon                  # TUI dashboard
```

Works with **any AI coding tool** — Claude Code, Codex, Cursor, Gemini, or manual use.

### As a Claude Code plugin

For automatic hook integration (event-driven audit on every edit):

```bash
claude plugin install quorum
```

This registers 12 lifecycle hooks that trigger audits automatically. The CLI still works alongside the plugin.

### From source

```bash
git clone https://github.com/berrzebb/quorum.git
cd quorum && npm install && npm run build
npm link                       # makes 'quorum' available globally
```

## CLI

```
quorum <command>

  setup          Initialize quorum in current project
  interview      Interactive requirement clarification
  daemon         Start TUI dashboard
  status         Show audit gate status
  audit          Trigger manual audit
  plan           Work breakdown planning
  ask <provider> Query a provider directly
  tool <name>    Run MCP analysis tool
  migrate        Import consensus-loop data into quorum
  help           Show help
```

## Migrating from consensus-loop

If you were using consensus-loop (v2.5.0), quorum can import your existing data:

```bash
quorum migrate            # import config, audit history, session state
quorum migrate --dry-run  # preview without changes
```

What it migrates:

| Data | From | To |
|------|------|----|
| Config | `.claude/consensus-loop/config.json` | `.claude/quorum/config.json` |
| Audit history | `.claude/audit-history.jsonl` | SQLite EventStore |
| Session state | `.session-state/retro-marker.json` | Preserved (shared location) |
| Watch/respond files | `docs/feedback/claude.md` | No change needed |
| MCP server | `.mcp.json` consensus-loop entry | Cloned as quorum entry |

Your existing watch file and evidence are preserved — quorum reads the same files.

## How it works

### Without a plugin (standalone)

```
you write code
    → quorum audit              # trigger manually
    → auditor reviews           # Codex, GPT, Claude, or any provider
    → quorum status             # check verdict
    → fix if rejected           # resubmit
    → quorum daemon             # watch the cycle in real-time TUI
```

### With Claude Code plugin (automatic)

```
you write code
    → PostToolUse hook fires    # automatic
    → trigger eval (T1/T2/T3)  # skip, simple, or deliberative
    → auditor runs              # background, debounced
    → verdict syncs             # tag promotion/demotion
    → session-gate              # blocks until retro complete
    → commit allowed
```

Both paths use the same core engine: `bus/` + `providers/` + `core/`.

## Architecture

```
quorum/
├── cli/          ← unified entry point (works without any plugin)
├── daemon/       ← Ink TUI dashboard (works standalone)
├── bus/          ← EventStore (SQLite) + pub/sub + stagnation detection + process mux
├── providers/    ← consensus protocol + trigger + router + agent loader
├── core/         ← audit protocol, templates, MCP tools
└── adapters/     ← optional IDE integrations (Claude Code hooks, Codex watcher)
```

The `adapters/` layer is **optional**. Everything above it runs independently.

## Core Concepts

### Enforcement Gates

Three gates that block progress until conditions are met:

| Gate | Blocks when | Releases when |
|------|------------|---------------|
| **Audit** | Evidence submitted | Auditor approves |
| **Retro** | Audit approved | Retrospective complete |
| **Quality** | Lint/test fails | All checks pass |

### Deliberative Consensus

For complex changes (T3), a 3-role protocol runs:

1. **Advocate**: finds merit in the submission
2. **Devil's Advocate**: challenges assumptions, checks root cause vs symptom
3. **Judge**: weighs both opinions, delivers final verdict

### Conditional Trigger

Not every change needs full consensus. A 6-factor scoring system determines the audit level:

| Tier | Score | Mode |
|------|-------|------|
| T1 | < 0.3 | Skip (micro change) |
| T2 | 0.3–0.7 | Simple (single auditor) |
| T3 | > 0.7 | Deliberative (3-role) |

### Stagnation Detection

If the audit loop cycles without progress, 4 patterns are detected:

- **Spinning**: same verdict 3+ times
- **Oscillation**: approve → reject → approve → reject
- **No drift**: identical rejection codes repeating
- **Diminishing returns**: improvement rate declining

### Dynamic Escalation

The tier router tracks failure history per task:

- 2 consecutive failures → escalate to higher tier
- 2 consecutive successes → downgrade back
- Frontier failures → stagnation signal

### Planner Documents

The planner skill produces 10 document types for structured project planning:

| Document | Level | Purpose |
|----------|-------|---------|
| **PRD** | Project | Product requirements — problem, goals, features, acceptance criteria |
| **Execution Order** | Project | Track dependency graph — which tracks to execute first |
| **Work Catalog** | Project | All tasks across all tracks with status and priority |
| **ADR** | Project | Architecture Decision Records — why, not just what |
| **Track README** | Track | Track scope, goals, success criteria, constraints |
| **Work Breakdown** | Track | Task decomposition — `### [task-id]` blocks with depends_on/blocks |
| **API Contract** | Track | Endpoint specs, request/response schemas, auth |
| **Test Strategy** | Track | Test plan — unit/integration/e2e scope, coverage targets |
| **UI Spec** | Track | Component hierarchy, states, interactions |
| **Data Model** | Track | Entity relationships, schemas, migrations |

## Providers

quorum is provider-agnostic. Bring your own auditor.

| Provider | Mechanism | Plugin needed? |
|----------|-----------|---------------|
| Claude Code | 12 native hooks | Optional (auto-triggers) |
| Codex | File watch + state polling | No |
| Cursor | — | Planned |
| Gemini | — | Planned |
| Manual | `quorum audit` | No |

## Tools & Verification

Deterministic tools that replace LLM judgment with facts. No hallucination possible.

**Analysis tools** (9):
```bash
quorum tool code_map src/              # symbol index
quorum tool dependency_graph .          # import DAG, cycles
quorum tool audit_scan src/             # type-safety, hardcoded patterns
quorum tool coverage_map                # per-file test coverage
quorum tool rtm_parse docs/rtm.md      # parse RTM → structured rows
quorum tool rtm_merge --base a --updates '["b"]'  # merge worktree RTMs
quorum tool audit_history --summary     # verdict patterns
quorum tool fvm_generate /project       # FE×API×BE access matrix
quorum tool fvm_validate --fvm_path x --base_url http://localhost:3000 --credentials '{}'
```

**Verification pipeline** (`quorum verify`):
```bash
quorum verify              # all checks
quorum verify CQ           # code quality (eslint)
quorum verify SEC          # OWASP security (10 patterns, semgrep if available)
quorum verify LEAK         # secrets in git (gitleaks if available, built-in fallback)
quorum verify DEP          # dependency vulnerabilities (npm audit)
quorum verify SCOPE        # diff vs evidence match
```

Full reference: [docs/en/TOOLS.md](docs/en/TOOLS.md) | [docs/ko/TOOLS.md](docs/ko/TOOLS.md)

## Tests

```bash
npm test                # 356 tests
npm run typecheck       # TypeScript check
npm run build           # compile
```

## CI/CD

GitHub Actions builds cross-platform binaries on tag push:

```bash
git tag v0.2.0
git push origin v0.2.0
# → linux-x64, darwin-x64, darwin-arm64, win-x64 binaries in Releases
```

## License

MIT
