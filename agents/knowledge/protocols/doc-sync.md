# Doc-Sync Protocol

Extract facts from code and fix numeric/structural mismatches across 3 documentation layers.

## 3 Layers

| Layer | Scope | Reference |
|-------|-------|-----------|
| **L1** | Public docs (README, AGENTS, TOOLS — EN/KO) | `references/l1-public-docs.md` |
| **L2** | RTM (Requirements Traceability Matrix) | `references/l2-rtm.md` |
| **L3** | Design docs (PRD, WB, Work Catalog) | `references/l3-design-docs.md` |

The `references/` path is relative to the skill directory invoking this protocol.

## Execution Flow

```
Phase 1: Fact Extraction
  Run extraction commands from L1 reference → build fact table
  Compare extracted values against documented values

Phase 2: L1 — Public Doc Sync
  For each target file: read → compare facts → fix mismatches → verify EN/KO parity

Phase 3: L2 — RTM Sync (only if planning_dir has RTM files)
  rtm_parse → verify code/test refs exist → update status columns

Phase 4: L3 — Design Doc Sync (only if planning_dir exists)
  git diff → WB status update → Work Catalog recalculation → PRD Track Map sync

Phase 5: Report
  Output structured summary of all changes across 3 layers
```

## When to Run

| Trigger | Scope | Invocation |
|---------|-------|------------|
| Manual | L1 + L2 + L3 | `/quorum:doc-sync` |
| Merge Phase 2.5 | L1 + L2 + L3 | Automatic (spawned by merge-worktree skill) |
| Version bump | L1 only | Manual or post-release |
| After audit pass | L2 + L3 | Orchestrator triggers |

## Fact Categories

Facts are extracted from code and compared against documentation values:

| Category | Source | Tools |
|----------|--------|-------|
| Hook counts (per adapter) | `platform/adapters/*/hooks/hooks.json` | Read + count |
| Shared module count | `platform/adapters/shared/*.mjs` | Glob + count |
| MCP tool count | `platform/core/tools/mcp-server.mjs` TOOLS array | Grep |
| Test count | `npm test` output | Shell |
| Agent/Skill counts (per adapter) | `platform/adapters/*/agents/`, `platform/adapters/*/skills/` | Glob + count |
| Version | `package.json` | Read |
| Trigger factor count | `platform/providers/trigger.ts` | Grep |
| Stagnation pattern count | `platform/bus/stagnation.ts` | Grep |
| Event type count | `platform/bus/events.ts` | Grep |
| Language count | `platform/core/languages/*/spec.mjs` | Glob + count |

## Available Tools

All 20 analysis tools are available for verification. Key tools for doc-sync:

| Tool | Use In Doc-Sync |
|------|----------------|
| `code_map` | Verify symbol counts, file structure |
| `dependency_graph` | Verify module relationships documented in README |
| `rtm_parse` | L2 — parse RTM rows for status verification |
| `rtm_merge` | L2 — merge worktree RTM into base |
| `audit_history` | Cross-check recent verdicts for L2/L3 status |
| `doc_coverage` | Verify documentation completeness claims |
| `coverage_map` | Verify test coverage numbers |

Run via: `quorum tool <tool> --json`

## 3-Adapter Awareness

Doc-sync must account for all 3 adapters when counting:

| Fact | Count Method |
|------|-------------|
| Hook total | Sum hooks across `platform/adapters/{claude-code,gemini,codex}/hooks/hooks.json` |
| Skill count per adapter | Count `adapters/{adapter}/skills/*/SKILL.md` separately |
| Agent count per adapter | Count `adapters/{adapter}/agents/*.md` separately |
| Shared skills | Count `platform/skills/*/SKILL.md` (adapter-independent) |

When a document says "N hooks" without specifying adapter, verify it means the per-adapter count or the total across all adapters (context-dependent).

## Language Registry Awareness

The fragment-based language registry (`languages/{lang}/spec.{domain}.mjs`) affects documentation:

- Language count: number of `languages/*/spec.mjs` directories
- Fragment count per language: `spec.*.mjs` files in each directory
- Quality domain count: unique domains across all languages
- These numbers appear in README, AGENTS, and CLAUDE.md

## Constraints

- **Text/prose is untouched** — only fix numbers, status values, and structural elements
- **Do NOT run tests** — only verify file existence (test execution is verify skill's job)
- **Skip L2 if no planning_dir** or no RTM files exist
- **Skip L3 if no planning_dir** exists
- **EN/KO parity** — both language variants must show identical numeric values
- **Verdicts are in SQLite** — do NOT look for verdict.md or gpt.md files
- **Context-aware matching** — when fixing a number, verify it refers to the correct entity (e.g., "22 hooks" might mean Claude Code hooks specifically, not total)

## Completion Gate

| # | Condition | Verification |
|---|-----------|-------------|
| 1 | Fact table produced | All extraction commands ran, comparison table output |
| 2 | L1 mismatches fixed | Zero numeric discrepancies between code and docs |
| 3 | EN/KO parity verified | Same numbers in both language variants |
| 4 | L2/L3 processed or skipped | Each layer has "N changes" or "skipped" status |
| 5 | Report output | 3-layer summary with before/after values |

A doc-sync run is complete only when all 5 conditions are met.
