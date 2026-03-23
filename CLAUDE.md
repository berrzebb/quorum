# quorum

Cross-model audit gate with structural enforcement. Edit → audit → agree → retro → commit.

## Quick Commands

```bash
npm run build          # tsc compile
npm run typecheck      # tsc --noEmit
npm test               # node --test tests/*.test.mjs
npm run dev            # tsx daemon/index.ts
```

## Module Map

```
cli/index.ts           ← quorum <command> dispatcher
  ├→ commands/setup.ts  ← project initialization
  ├→ commands/status.ts ← gate status (--attach/--capture for mux remote view)
  ├→ commands/audit.ts  ← manual audit trigger
  ├→ commands/plan.ts   ← work breakdown listing
  ├→ commands/ask.ts    ← provider direct query
  └→ commands/tool.ts   ← MCP tool CLI

daemon/index.ts         ← Ink TUI entry point (StateReader + LockService injection)
  ├→ app.tsx            ← GateStatus + AgentPanel + TrackProgress + AuditStream + ItemStates + Locks + Specialists
  └→ state-reader.ts    ← SQLite-only state reader (gates, items, locks, specialists, tracks)

bus/
  ├→ bus.ts             ← QuorumBus (EventEmitter + SQLite/JSONL)
  ├→ store.ts           ← EventStore (SQLite WAL) + UnitOfWork + TransactionalUnitOfWork
  ├→ lock.ts            ← LockService (atomic SQL lock, replaces JSON lock files)
  ├→ projector.ts       ← MarkdownProjector (SQLite → markdown view generation)
  ├→ events.ts          ← 33+ event types (incl. specialist.detect/tool/review)
  ├→ stagnation.ts      ← 4-pattern detection
  └→ mux.ts             ← ProcessMux (tmux/psmux/raw)

providers/
  ├→ provider.ts        ← QuorumProvider + Auditor interfaces
  ├→ consensus.ts       ← DeliberativeConsensus (Advocate/Devil/Judge)
  ├→ trigger.ts         ← 12-factor conditional trigger (T1/T2/T3 + domain signals)
  ├→ router.ts          ← TierRouter (escalation/downgrade)
  ├→ agent-loader.ts    ← 4-tier persona resolution + LRU cache
  ├→ domain-detect.ts   ← Zero-cost domain detection (9 domains: perf, migration, a11y, ...)
  ├→ domain-router.ts   ← Conditional specialist activation (domain × tier)
  ├→ specialist.ts      ← Specialist review orchestrator (tools + agents → enriched evidence)
  ├→ claude-code/       ← ClaudeCodeProvider (hook-forwarding)
  └→ codex/             ← CodexProvider (file-watch) + CodexAuditor

core/
  ├→ bridge.mjs         ← MJS hooks ↔ TS modules bridge (+ domain/specialist routing)
  ├→ context.mjs        ← config, paths, parser, i18n, refreshConfigIfChanged
  ├→ cli-runner.mjs     ← cross-platform spawn (resolveBinary, execResolved, gitSync)
  ├→ audit.mjs          ← re-export shim → core/audit/ modules
  ├→ audit/             ← split audit modules (args, session, scope, pre-verify, codex-runner, solo-verdict, index)
  ├→ respond.mjs        ← tag sync + verdict recording (dual-write to SQLite)
  ├→ enforcement.mjs    ← structural enforcement
  └→ tools/             ← 17 MCP tools (code_map, rtm_parse, fvm_generate, perf_scan, a11y_scan, ...)

adapters/claude-code/
  ├→ index.mjs          ← PostToolUse hook (trigger eval + domain routing + specialist tools + bridge)
  ├→ session-gate.mjs   ← PreToolUse (retro enforcement, SQLite KV + JSON fallback)
  ├→ hooks/hooks.json   ← 12 hook registrations
  ├→ skills/            ← 9 skills
  ├→ agents/            ← 12 agents (implementer, scout, ui-reviewer + 9 specialists)
  └→ commands/          ← 9 CLI shortcuts
```

## Key Patterns

- **Bridge**: `core/bridge.mjs` connects MJS hooks to compiled TS modules. Fail-safe — hooks run in legacy mode if dist/ is unavailable.
- **Consensus Gate**: evidence → trigger eval → domain detection → specialist tools → T1 skip / T2 simple / T3 deliberative → verdict → retro → commit.
- **SQLite Unified State**: `state_transitions`, `locks`, `kv_state` tables + `events` — single source of truth. Markdown files become read-only projections.
- **Domain Specialists**: Zero-cost file pattern matching → 8 deterministic tools + 9 LLM agents activated conditionally per domain × tier.
- **Atomic Locks**: `LockService` uses INSERT...ON CONFLICT for TOCTOU-free lock acquisition (replaces JSON lock files).
- **ProcessMux**: auto-detects tmux (Unix) / psmux (Windows) / raw fallback. `--attach`/`--capture` for remote dashboard.
- **Fail-open**: all hooks pass through on error. No system lockout.

## Testing

```bash
npm test                              # all (513 tests)
node --test tests/e2e-smoke.test.mjs  # full pipeline
node --test tests/bridge.test.mjs     # MJS↔TS bridge
node --test tests/store.test.mjs      # SQLite EventStore
node --test tests/specialist-tools.test.mjs  # 8 specialist tools
node --test tests/domain-router.test.mjs     # domain detection + routing
```
