# agents/knowledge/ — Shared Protocol Corpus

## Purpose

This directory is the **cross-adapter shared protocol layer** for all quorum agents and skills.
Every protocol file here is referenced by all adapters (Claude Code, Gemini, Codex, OpenAI-Compatible)
and by the canonical skill definitions in `platform/skills/`.

Protocol change here = 1 file edit = all adapters reflect. No duplication.

## Why Root (Not Under `platform/`)

`agents/knowledge/` is intentionally **not** under `platform/`. It is a protocol corpus, not
runtime source code:

- `platform/` contains compiled TypeScript, MJS modules, and adapter I/O — things that `tsc`
  builds and Node.js executes.
- `agents/knowledge/` contains Markdown protocol definitions — referenced at prompt-construction
  time, never compiled or executed. They are instruction documents consumed by LLM agents.

This is the same reasoning that keeps `tests/` at root: they are shared concerns,
not part of the platform runtime source tree. (`languages/` has since moved to `platform/core/languages/`.)

## Ownership Rules

1. **All-adapter check required.** Any change to a protocol file here must be verified against
   all adapter wrappers (`platform/adapters/claude-code/`, `platform/adapters/gemini/`, `platform/adapters/codex/`,
   `platform/adapters/openai-compatible/`) to ensure no wrapper assumptions are broken.

2. **No adapter-specific content.** Protocol files must remain adapter-neutral. Tool names,
   env vars, and invocation paths belong in adapter wrappers, not here.

3. **Reviewed changes only.** These protocols define behavioral contracts for LLM agents.
   Casual edits can silently change agent behavior across the entire system.

## Stability Contract

Files in this directory are **stable references**. They are not frequently changed and should
be treated as semi-frozen contracts:

- Adding a new protocol file is acceptable (with all-adapter verification).
- Modifying an existing protocol requires checking downstream consumers:
  adapters, canonical skills, and any CLAUDE.md/ARCHITECTURE.md entries that describe it.
- Removing a protocol file requires migration of all references first.

## Protocol Index

### Core Protocols

| File | Description |
|------|-------------|
| `implementer-protocol.md` | Code-only execution flow: self-check delegation to self-checker, correction delegation to fixer |
| `scout-protocol.md` | Phase 5-8 RTM gap analyzer (upstream: wb-parser + rtm-scanner) |
| `specialist-base.md` | JSON output format, confidence >= 0.8 filter, max 10 findings per review |
| `ui-review-protocol.md` | UI-1~8 verification checklist, report format, completion gate |
| `doc-sync-protocol.md` | 3-layer fact extraction, numeric mismatch detection, section parity |
| `parliament-rules.md` | Standing rules for parliamentary sessions: consensus, amendment voting, confluence |
| `tool-inventory.md` | 26-tool catalog (codebase, domain, RTM/FVM, audit, guide) |

### Domain Knowledge (`domains/`)

| File | Domain |
|------|--------|
| `domains/a11y.md` | Accessibility |
| `domains/compat.md` | Cross-browser / cross-platform compatibility |
| `domains/compliance.md` | Regulatory compliance |
| `domains/concurrency.md` | Concurrency and parallelism |
| `domains/docs.md` | Documentation quality |
| `domains/i18n.md` | Internationalization |
| `domains/infra.md` | Infrastructure and deployment |
| `domains/migration.md` | Migration and upgrade paths |
| `domains/observability.md` | Logging, tracing, metrics |
| `domains/perf.md` | Performance optimization |
| `domains/security.md` | Security hardening |

## Inheritance Chain

```
agents/knowledge/ (this directory)     <- Protocol definitions (stable, adapter-neutral)
        |
        v  referenced by
platform/skills/ (canonical)           <- Protocol-neutral skill definitions + references
        |
        v  adapted by (4 equal peers)
adapters/{claude-code,gemini,codex,openai-compatible}/skills/
                                       <- Adapter-native tool names + invocation paths
```

See `platform/skills/ARCHITECTURE.md` for the full inheritance model and wrapper rules.
