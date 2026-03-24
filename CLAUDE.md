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
  ├→ commands/setup.ts      ← project initialization
  ├→ commands/status.ts     ← gate status (--attach/--capture for mux remote view)
  ├→ commands/audit.ts      ← manual audit trigger
  ├→ commands/plan.ts       ← work breakdown listing
  ├→ commands/orchestrate.ts ← track orchestration (WB parser + selectMode + claims)
  ├→ commands/ask.ts        ← provider direct query
  └→ commands/tool.ts       ← MCP tool CLI

daemon/index.ts         ← Ink TUI entry point (StateReader + LockService injection)
  ├→ app.tsx            ← GateStatus + AgentPanel + FitnessPanel + TrackProgress + AuditStream + ItemStates + Locks + Specialists
  ├→ state-reader.ts    ← SQLite-only state reader (gates, items, locks, specialists, tracks, fitness)
  └→ components/        ← GateStatus, AgentPanel, FitnessPanel, AuditStream, TrackProgress, Header

bus/
  ├→ bus.ts             ← QuorumBus (EventEmitter + SQLite/JSONL)
  ├→ store.ts           ← EventStore (SQLite WAL) + UnitOfWork + TransactionalUnitOfWork
  ├→ lock.ts            ← LockService (atomic SQL lock, replaces JSON lock files)
  ├→ claim.ts           ← ClaimService (per-file ownership for worktree conflict prevention)
  ├→ parallel.ts        ← ParallelPlanner (dependency-driven execution groups via graph coloring)
  ├→ orchestrator.ts    ← OrchestratorMode (5-mode auto-selection: serial/parallel/fan-out/pipeline/hybrid)
  ├→ auto-learn.ts      ← Auto-learning (repeat pattern detection + CLAUDE.md rule suggestions)
  ├→ projector.ts       ← MarkdownProjector (SQLite → markdown view generation)
  ├→ events.ts          ← 39 event types (incl. finding.detect/ack/resolve + fitness.compute/gate/trend)
  ├→ message-bus.ts     ← MessageBus (finding-level SQLite communication, replaces file-based IPC)
  ├→ fitness.ts         ← Fitness score engine (5-component 0.0-1.0 quality metric)
  ├→ fitness-loop.ts    ← Autonomous fitness gate (proceed/self-correct/auto-reject)
  ├→ stagnation.ts      ← 5-pattern detection (incl. fitness-plateau)
  └→ mux.ts             ← ProcessMux (tmux/psmux/raw)

providers/
  ├→ provider.ts        ← QuorumProvider + Auditor interfaces
  ├→ consensus.ts       ← DeliberativeConsensus (Advocate/Devil/Judge)
  ├→ trigger.ts         ← 10-factor conditional trigger (T1/T2/T3 + domain + fitness + blast radius)
  ├→ ast-analyzer.ts    ← TypeScript Compiler API wrapper (sourceFile + program mode, 5 analyzers + cross-file)
  ├→ router.ts          ← TierRouter (escalation/downgrade)
  ├→ agent-loader.ts    ← 4-tier persona resolution + LRU cache
  ├→ domain-detect.ts   ← Zero-cost domain detection (9 domains: perf, migration, a11y, ...)
  ├→ domain-router.ts   ← Conditional specialist activation (domain × tier)
  ├→ specialist.ts      ← Specialist review orchestrator (tools + agents → enriched evidence)
  ├→ claude-code/       ← ClaudeCodeProvider (hook-forwarding)
  └→ codex/             ← CodexProvider (file-watch) + CodexAuditor

core/
  ├→ bridge.mjs         ← MJS hooks ↔ TS modules bridge (+ domain/specialist/claim/orchestrator routing)
  ├→ context.mjs        ← config, paths, parser, i18n, refreshConfigIfChanged
  ├→ cli-runner.mjs     ← cross-platform spawn (resolveBinary, execResolved, gitSync)
  ├→ audit.mjs          ← re-export shim → core/audit/ modules
  ├→ audit/             ← split audit modules (args, session, scope, pre-verify, codex-runner, solo-verdict, index)
  ├→ respond.mjs        ← Event Reactor (SQLite verdict → side-effects only, no markdown)
  ├→ enforcement.mjs    ← structural enforcement
  ├→ tools/             ← 19 MCP tools (code_map, blast_radius, rtm_parse, fvm_generate, perf_scan, a11y_scan, ai_guide, ...)
  └→ tools/ast-bridge.mjs ← Fail-safe MJS↔AST bridge (hybrid scanning)

languages/
  ├→ registry.mjs       ← LanguageRegistry (auto-discover + fragment merge, CORE_FIELDS enforcement)
  ├→ typescript/         ← spec.mjs (core) + spec.{symbols,imports,perf,a11y,compat,observability,doc}.mjs
  ├→ go/                 ← spec.mjs + 7 fragments (symbols, imports, perf, security, observability, compat, doc)
  ├→ python/             ← spec.mjs + 7 fragments
  ├→ rust/               ← spec.mjs + 7 fragments
  └→ java/               ← spec.mjs + 7 fragments

agents/knowledge/          ← Cross-adapter shared protocols
  ├→ implementer-protocol.md  ← execution flow, completion gate, anti-patterns
  ├→ scout-protocol.md        ← RTM generation 8-phase, output rules
  ├→ specialist-base.md       ← JSON output format, judgment criteria
  └→ domains/{perf,a11y,...}.md ← 9 domain knowledge files

adapters/shared/           ← Adapter-agnostic business logic (8 modules)
  ├→ repo-resolver.mjs     ← resolveRepoRoot() (git → env → fallback)
  ├→ config-resolver.mjs   ← findConfigPath(), loadConfig(), extractTags()
  ├→ audit-state.mjs       ← readAuditStatus(), buildResumeState(), buildStatusSignals()
  ├→ trigger-runner.mjs    ← validateEvidenceFormat(), buildTriggerContext()
  ├→ tool-names.mjs        ← TOOL_MAP (claude-code/gemini/codex canonical mapping)
  └→ ...                   ← first-run, context-reinforcement, quality-runner

adapters/claude-code/
  ├→ index.mjs          ← PostToolUse hook (trigger eval + domain routing + specialist tools + bridge)
  ├→ session-gate.mjs   ← PreToolUse (retro enforcement, SQLite KV + JSON fallback)
  ├→ hooks/hooks.json   ← 15 hook registrations (incl. UserPromptSubmit, StopFailure, PostToolUseFailure)
  ├→ skills/            ← 9 skills
  ├→ agents/            ← 12 agents (reference agents/knowledge/ + Claude Code tool bindings)
  └→ commands/          ← 9 CLI shortcuts

adapters/gemini/
  ├→ gemini-extension.json ← extension manifest (MCP server registration)
  ├→ hooks/hooks.json      ← 5 hook registrations (SessionStart, BeforeAgent, BeforeTool, AfterTool, SessionEnd)
  ├→ skills/               ← 8 skills (audit, status, guide, verify + implementer, scout, perf-analyst, ui-reviewer)
  └→ commands/             ← 4 TOML commands
```

## Key Patterns

- **Bridge**: `core/bridge.mjs` connects MJS hooks to compiled TS modules. Fail-safe — hooks run in legacy mode if dist/ is unavailable.
- **Consensus Gate**: evidence → trigger eval → domain detection → specialist tools → T1 skip / T2 simple / T3 deliberative → verdict → retro → commit.
- **SQLite Unified State**: `state_transitions`, `locks`, `kv_state` tables + `events` — single source of truth. No verdict files (verdict.md/gpt.md eliminated). `audit-status.json` marker for fast-path hook detection.
- **Domain Specialists**: Zero-cost file pattern matching → 8 deterministic tools + 9 LLM agents activated conditionally per domain × tier.
- **Atomic Locks**: `LockService` uses INSERT...ON CONFLICT for TOCTOU-free lock acquisition (replaces JSON lock files).
- **Provider-per-Role**: `config.json` `consensus.roles` maps roles to providers (e.g. advocate→openai, devil→claude, judge→codex). `createConsensusAuditors()` in factory.ts.
- **Finding-Level Bus**: `MessageBus` enables per-finding submit/ack/resolve via SQLite events. Replaces file-based IPC for reviewer communication.
- **ProcessMux**: auto-detects tmux (Unix) / psmux (Windows) / raw fallback. `--attach`/`--capture` for remote dashboard.
- **Fail-open**: all hooks pass through on error. No system lockout.
- **Scan-ignore pragma**: Add `// scan-ignore` to any source line to suppress `runPatternScan` findings on that line. Used for self-referential pattern definitions (e.g. perf_scan's own regex patterns).
- **Hybrid Scanning**: Regex first pass (speed) → AST second pass (precision). `runPatternScan` accepts optional `astRefine` callback. `perf_scan` is the first hybrid tool.
- **Fitness Score**: 5-component quality metric (typeSafety, testCoverage, patternScan, buildHealth, complexity). `FitnessLoop` gates LLM audit: auto-reject (score drop >0.15) / self-correct (>0.05) / proceed.
- **AST Analyzer**: TypeScript Compiler API wrapper. Two modes: `sourceFile` (fast single-file, 5 analyzers) and `program` (cross-file: unused export detection, import cycle detection via DFS).
- **Event Reactor**: `respond.mjs` reads verdict events from SQLite and executes side-effects only. No markdown read/write. All state via `bridge.queryEvents()` + `bridge.queryItemStates()`.
- **Verdict Flow**: External auditor (Codex) outputs verdict as response text → captured via `streamCodexOutput()` `verdictText` → parsed by `parseVerdictText()` → stored in SQLite via `bridge.recordTransition()`. Solo/auto modes generate verdict in-process. `audit-status.json` marker written for fast-path hooks (session-start, prompt-submit).
- **File Claims**: `ClaimService` provides per-file ownership for parallel agents. `INSERT...ON CONFLICT` pattern (same as LockService). TTL-based expiry. Auto-released on `SubagentStop`.
- **Execution Planner**: `planParallel()` uses graph coloring for conflict-free execution groups. `selectMode()` auto-selects serial/parallel/fan-out/pipeline/hybrid based on conflict density + dependency topology.
- **Auto-Learning**: `analyzeAndSuggest()` detects repeat rejection patterns (3+ occurrences) from audit history and generates CLAUDE.md rule suggestions.
- **Blast Radius**: BFS on reverse import graph (`inEdges`) computes transitive dependents of changed files. `buildRawGraph()` extracted from `dependency_graph` for reuse. 10th trigger factor (ratio > 0.1 → score += up to 0.15). Pre-verify evidence includes blast radius section.
- **3-Layer Adapter**: I/O (adapter-specific stdin/stdout) + Business logic (`adapters/shared/`) + Bridge (`core/`). New adapter = I/O wrappers only (~650 lines vs ~2,000).
- **Shared Agent Knowledge**: `agents/knowledge/` protocols referenced by all adapters. Protocol change → 1 file edit → all adapters reflect. Agents keep only tool-name bindings + path variables.
- **Fragment-Only Language Specs**: `languages/registry.mjs` enforces `CORE_FIELDS` whitelist. `spec.mjs` = metadata only. Domain data (symbols, imports, qualityRules) MUST be in `spec.{domain}.mjs` fragments. No inline fallback.
- **Adapter Env Fallback**: `core/context.mjs` resolves `QUORUM_ADAPTER_ROOT` → `CLAUDE_PLUGIN_ROOT` → `GEMINI_EXTENSION_ROOT` for config, locales, plugin paths.
- **Tool Name Mapping**: `adapters/shared/tool-names.mjs` maps canonical operations (bash, read, write) to adapter-native names (Bash/shell, Read/read_file, Write/write_file).

## Testing

```bash
npm test                              # all (812 tests)
node --test tests/e2e-smoke.test.mjs  # full pipeline
node --test tests/bridge.test.mjs     # MJS↔TS bridge
node --test tests/store.test.mjs      # SQLite EventStore
node --test tests/specialist-tools.test.mjs  # 9 specialist tools (incl. ai_guide)
node --test tests/message-bus.test.mjs       # Finding-level MessageBus
node --test tests/domain-router.test.mjs     # domain detection + routing
node --test tests/ast-analyzer.test.mjs      # AST analyzer (5 analyzers)
node --test tests/hybrid-scan.test.mjs       # Hybrid regex+AST scanning
node --test tests/fitness.test.mjs           # Fitness score engine
node --test tests/fitness-loop.test.mjs      # Fitness gate + autonomous loop
node --test tests/trigger-fitness.test.mjs   # Trigger + stagnation fitness integration
node --test tests/ast-program.test.mjs      # AST program mode (cross-file analysis)
node --test tests/claim.test.mjs           # ClaimService + ParallelPlanner + OrchestratorMode
node --test tests/blast-radius.test.mjs   # Blast radius (BFS, graph, trigger integration)
node --test tests/shared-adapter.test.mjs  # Shared adapter modules (8 modules, 28 tests)
node --test tests/language-registry.test.mjs # Language registry + fragment loading (38 tests)
node --test tests/agent-persona.test.mjs   # Agent persona loading + shared knowledge (22 tests)
```
