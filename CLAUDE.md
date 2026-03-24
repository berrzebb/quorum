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
  ├→ commands/parliament.ts ← parliamentary deliberation CLI (topic → 3-role consensus → CPS)
  ├→ commands/ask.ts        ← provider direct query
  └→ commands/tool.ts       ← MCP tool CLI

daemon/index.ts         ← Ink TUI entry point (StateReader + LockService injection)
  ├→ app.tsx            ← GateStatus + AgentPanel + FitnessPanel + TrackProgress + AuditStream + ItemStates + Locks + Specialists
  ├→ state-reader.ts    ← SQLite-only state reader (gates, items, locks, specialists, tracks, fitness)
  └→ components/        ← GateStatus, AgentPanel, FitnessPanel, ParliamentPanel, AuditStream, TrackProgress, Header

bus/
  ├→ bus.ts             ← QuorumBus (EventEmitter + SQLite/JSONL)
  ├→ store.ts           ← EventStore (SQLite WAL) + UnitOfWork + TransactionalUnitOfWork
  ├→ lock.ts            ← LockService (atomic SQL lock, replaces JSON lock files)
  ├→ claim.ts           ← ClaimService (per-file ownership for worktree conflict prevention)
  ├→ parallel.ts        ← ParallelPlanner (dependency-driven execution groups via graph coloring)
  ├→ orchestrator.ts    ← OrchestratorMode (5-mode auto-selection: serial/parallel/fan-out/pipeline/hybrid)
  ├→ auto-learn.ts      ← Auto-learning (repeat pattern detection + CLAUDE.md rule suggestions)
  ├→ projector.ts       ← MarkdownProjector (SQLite → markdown view generation)
  ├→ events.ts          ← 53 event types (incl. finding.*, fitness.*, parliament.*)
  ├→ message-bus.ts     ← MessageBus (finding-level SQLite communication, replaces file-based IPC)
  ├→ fitness.ts         ← Fitness score engine (7-component 0.0-1.0 quality metric)
  ├→ fitness-loop.ts    ← Autonomous fitness gate (proceed/self-correct/auto-reject)
  ├→ stagnation.ts      ← 7-pattern detection (incl. fitness-plateau, expansion, consensus-divergence)
  ├→ meeting-log.ts     ← Meeting log accumulation, convergence detection, 5-classification, CPS generation
  ├→ amendment.ts       ← Amendment process (propose/vote/resolve, majority voting)
  ├→ confluence.ts      ← Confluence verification (4-point post-audit integrity: law-code/part-whole/intent-result/law-law)
  ├→ normal-form.ts     ← Normal form convergence tracking (raw-output → autofix → manual-fix → normal-form)
  └→ mux.ts             ← ProcessMux (tmux/psmux/raw)

providers/
  ├→ provider.ts        ← QuorumProvider + Auditor interfaces
  ├→ consensus.ts       ← DeliberativeConsensus (Advocate/Devil/Judge + Diverge-Converge)
  ├→ trigger.ts         ← 12-factor conditional trigger (T1/T2/T3 + domain + fitness + blast radius + velocity + stagnation)
  ├→ ast-analyzer.ts    ← TypeScript Compiler API wrapper (sourceFile + program mode, 5 analyzers + cross-file)
  ├→ router.ts          ← TierRouter (escalation/downgrade)
  ├→ agent-loader.ts    ← 4-tier persona resolution + LRU cache
  ├→ domain-detect.ts   ← Zero-cost domain detection (10 domains: perf, migration, a11y, security, ...)
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
  ├→ tools/             ← 20 MCP tools (code_map, blast_radius, rtm_parse, fvm_generate, perf_scan, a11y_scan, ai_guide, ...)
  └→ tools/ast-bridge.mjs ← Fail-safe MJS↔AST bridge (hybrid scanning)

languages/
  ├→ registry.mjs       ← LanguageRegistry (auto-discover + fragment merge, CORE_FIELDS enforcement)
  ├→ typescript/         ← spec.mjs (core) + spec.{symbols,imports,perf,a11y,compat,observability,doc}.mjs
  ├→ go/                 ← spec.mjs + 7 fragments (symbols, imports, perf, security, observability, compat, doc)
  ├→ python/             ← spec.mjs + 7 fragments
  ├→ rust/               ← spec.mjs + 7 fragments
  └→ java/               ← spec.mjs + 7 fragments

agents/knowledge/          ← Cross-adapter shared protocols
  ├→ implementer-protocol.md  ← execution flow, correction round, completion gate, anti-patterns
  ├→ scout-protocol.md        ← RTM generation 8-phase, output rules
  ├→ specialist-base.md       ← JSON output format, judgment criteria
  ├→ ui-review-protocol.md    ← UI-1~8 verification checklist, report format, completion gate
  ├→ doc-sync-protocol.md     ← 3-layer fact extraction, numeric mismatch, section parity
  ├→ tool-inventory.md        ← 20-tool catalog (codebase, domain, RTM/FVM, audit, guide)
  └→ domains/{perf,a11y,security,migration,...}.md ← 11 domain knowledge files

adapters/shared/           ← Adapter-agnostic business logic (17 modules)
  ├→ repo-resolver.mjs     ← resolveRepoRoot() (git → env → fallback)
  ├→ config-resolver.mjs   ← findConfigPath(), loadConfig(), extractTags()
  ├→ audit-state.mjs       ← readAuditStatus(), buildResumeState(), buildStatusSignals()
  ├→ trigger-runner.mjs    ← validateEvidenceFormat(), buildTriggerContext()
  ├→ tool-names.mjs        ← TOOL_MAP (claude-code/gemini/codex canonical mapping)
  ├→ hook-runner.mjs       ← HookRunner engine (command/http, deny-first-break, async fire-and-forget)
  ├→ hook-loader.mjs       ← HOOK.md YAML parser + JSON config → HooksConfig + merge
  ├→ hook-bridge.mjs       ← HookRunner → PreToolHook/PostToolHook/AuditGate adapters
  ├→ ndjson-parser.mjs     ← Stream NDJSON line parser (10MB buffer guard)
  ├→ cli-adapter.mjs       ← Multi-CLI adapters (Claude/Codex/Gemini NDJSON wire format)
  ├→ jsonrpc-client.mjs    ← JSON-RPC 2.0 stdio client (Codex app-server mode)
  ├→ sdk-tool-bridge.mjs   ← JSON Schema → Zod conversion (SDK native tool loops)
  ├→ mux-adapter.mjs       ← ProcessMux ↔ CliAdapter bridge (spawn/send/capture/awaitConsensus)
  └→ ...                   ← first-run, context-reinforcement, quality-runner

adapters/claude-code/
  ├→ index.mjs          ← PostToolUse hook (trigger eval + domain routing + specialist tools + bridge)
  ├→ session-gate.mjs   ← PreToolUse (retro enforcement, SQLite KV + JSON fallback)
  ├→ hooks/hooks.json   ← 22 hook registrations (full spec: incl. PermissionRequest, Notification, ConfigChange, Elicitation)
  ├→ skills/            ← 14 skills (adapter wrappers; see skills/ARCHITECTURE.md)
  ├→ agents/            ← 13 agents (incl. doc-sync; reference agents/knowledge/ + Claude Code tool bindings)
  └→ commands/          ← 10 CLI shortcuts (incl. cl-docs)

adapters/gemini/
  ├→ gemini-extension.json ← extension manifest (MCP server registration)
  ├→ hooks/hooks.json      ← 11 hook registrations (full spec: incl. AfterAgent, BeforeModel, AfterModel, PreCompress, Notification)
  ├→ skills/               ← 14 skills (10 shared + implementer, scout, perf-analyst, ui-reviewer)
  └→ commands/             ← 4 TOML commands

adapters/codex/
  ├→ hooks/hooks.json      ← 5 hook registrations (SessionStart, Stop, UserPromptSubmit, AfterAgent, AfterToolUse)
  └→ skills/               ← 14 skills (10 shared + implementer, scout, perf-analyst, ui-reviewer)
```

## Key Patterns

- **Bridge**: `core/bridge.mjs` connects MJS hooks to compiled TS modules. Fail-safe — hooks run in legacy mode if dist/ is unavailable.
- **Consensus Gate**: evidence → trigger eval → domain detection → specialist tools → T1 skip / T2 simple / T3 deliberative → verdict → retro → commit.
- **SQLite Unified State**: `state_transitions`, `locks`, `kv_state` tables + `events` — single source of truth. No verdict files (verdict.md/gpt.md eliminated). `audit-status.json` marker for fast-path hook detection.
- **Domain Specialists**: Zero-cost file pattern matching → 20 deterministic tools + domain-specific LLM agents activated conditionally per domain × tier. 11 domains: perf, a11y, compat, compliance, concurrency, docs, i18n, infra, observability, migration, security.
- **Atomic Locks**: `LockService` uses INSERT...ON CONFLICT for TOCTOU-free lock acquisition (replaces JSON lock files).
- **Provider-per-Role**: `config.json` `consensus.roles` maps roles to providers (e.g. advocate→openai, devil→claude, judge→codex). `createConsensusAuditors()` in factory.ts.
- **Finding-Level Bus**: `MessageBus` enables per-finding submit/ack/resolve via SQLite events. Replaces file-based IPC for reviewer communication.
- **ProcessMux**: auto-detects tmux (Unix) / psmux (Windows) / raw fallback. `--attach`/`--capture` for remote dashboard.
- **Fail-open**: all hooks pass through on error. No system lockout.
- **Scan-ignore pragma**: Add `// scan-ignore` to any source line to suppress `runPatternScan` findings on that line. Used for self-referential pattern definitions (e.g. perf_scan's own regex patterns).
- **Hybrid Scanning**: Regex first pass (speed) → AST second pass (precision). `runPatternScan` accepts optional `astRefine` callback. `perf_scan` is the first hybrid tool.
- **Fitness Score**: 7-component quality metric (typeSafety, testCoverage, patternScan, buildHealth, complexity, security, dependencies). `FitnessLoop` gates LLM audit: auto-reject (score drop >0.15) / self-correct (>0.05) / proceed.
- **AST Analyzer**: TypeScript Compiler API wrapper. Two modes: `sourceFile` (fast single-file, 5 analyzers) and `program` (cross-file: unused export detection, import cycle detection via DFS).
- **Event Reactor**: `respond.mjs` reads verdict events from SQLite and executes side-effects only. No markdown read/write. All state via `bridge.queryEvents()` + `bridge.queryItemStates()`.
- **Verdict Flow**: External auditor (Codex) outputs verdict as response text → captured via `streamCodexOutput()` `verdictText` → parsed by `parseVerdictText()` → stored in SQLite via `bridge.recordTransition()`. Solo/auto modes generate verdict in-process. `audit-status.json` marker written for fast-path hooks (session-start, prompt-submit).
- **File Claims**: `ClaimService` provides per-file ownership for parallel agents. `INSERT...ON CONFLICT` pattern (same as LockService). TTL-based expiry. Auto-released on `SubagentStop`.
- **Execution Planner**: `planParallel()` uses graph coloring for conflict-free execution groups. `selectMode()` auto-selects serial/parallel/fan-out/pipeline/hybrid based on conflict density + dependency topology.
- **Auto-Learning**: `analyzeAndSuggest()` detects repeat rejection patterns (3+ occurrences) from audit history and generates CLAUDE.md rule suggestions. `learnFromStagnation()` feeds stagnation patterns back into trigger scoring (FDE feedback loop).
- **Blast Radius**: BFS on reverse import graph (`inEdges`) computes transitive dependents of changed files. `buildRawGraph()` extracted from `dependency_graph` for reuse. Trigger factor (ratio > 0.1 → score += up to 0.15). Pre-verify evidence includes blast radius section.
- **3-Layer Adapter**: I/O (adapter-specific stdin/stdout) + Business logic (`adapters/shared/`) + Bridge (`core/`). New adapter = I/O wrappers only (~650 lines vs ~2,000).
- **Shared Agent Knowledge**: `agents/knowledge/` protocols referenced by all adapters. Protocol change → 1 file edit → all adapters reflect. Agents keep only tool-name bindings + path variables.
- **Fragment-Only Language Specs**: `languages/registry.mjs` enforces `CORE_FIELDS` whitelist. `spec.mjs` = metadata only. Domain data (symbols, imports, qualityRules) MUST be in `spec.{domain}.mjs` fragments. No inline fallback.
- **Adapter Env Fallback**: `core/context.mjs` resolves `QUORUM_ADAPTER_ROOT` → `CLAUDE_PLUGIN_ROOT` → `GEMINI_EXTENSION_ROOT` for config, locales, plugin paths.
- **Tool Name Mapping**: `adapters/shared/tool-names.mjs` maps canonical operations (bash, read, write) to adapter-native names (Bash/shell, Read/read_file, Write/write_file).
- **HookRunner Engine**: `adapters/shared/hook-runner.mjs` — generic hook execution engine (ported from SoulFlow). command/http handlers, env interpolation, deny-first-break, async fire-and-forget, matcher filtering. `hook-loader.mjs` loads from HOOK.md YAML or JSON config. `hook-bridge.mjs` adapts to PreToolHook/PostToolHook/AuditGate interfaces.
- **NDJSON Wire Protocol**: `ndjson-parser.mjs` + `cli-adapter.mjs` — stream-based NDJSON parsing for 3 CLI formats (Claude stream-json, Codex exec --json, Gemini stream-json). Unified `AgentOutputMessage` type (assistant_chunk, tool_use, tool_result, complete, error). Factory: `createCliAdapter("claude"|"codex"|"gemini")`.
- **JSON-RPC Client**: `jsonrpc-client.mjs` — stdio JSON-RPC 2.0 client for Codex app-server mode. Bidirectional: client requests + server-initiated requests + notifications. 10MB buffer guard, request timeout, auto-reject on process exit.
- **SDK Tool Bridge**: `sdk-tool-bridge.mjs` — JSON Schema → Zod conversion for Claude Agent SDK native tool loops. Optional dependency (`@anthropic-ai/claude-agent-sdk` + `zod`). Returns null if unavailable.
- **MuxAdapter**: `mux-adapter.mjs` — bridges ProcessMux (tmux/psmux) sessions with CliAdapter/NdjsonParser. `spawn()` creates a CLI session per model, `send()` writes prompts via mux, `capture()` parses NDJSON output. `spawnConsensus()` + `awaitConsensus()` for 3-model deliberative protocol.
- **Doc-Sync**: `agents/knowledge/doc-sync-protocol.md` — extracts facts from code (hook counts, tool counts, test counts, versions) and fixes numeric mismatches + section parity gaps in 8 doc files. 3-adapter aware (counts all adapters). Runs automatically in merge-worktree Phase 2.5 before squash commit. `/quorum:doc-sync` for manual invocation.
- **Skill Architecture**: `skills/ARCHITECTURE.md` — protocol-neutral inheritance: `agents/knowledge/` (protocols) → `skills/` (shared canonical + references) → 3 equal adapter wrappers (Claude Code / Gemini / Codex). Each adapter skill = tool mapping + protocol ref. References resolve via `skills/*/references/` paths.
- **Diverge-Converge Consensus**: `consensus.ts` `runDivergeConverge()` — Parliament-style deliberation. Phase A: free divergence (no role constraints, all speak freely). Phase B: Judge converges into 4 MECE registers (statusChanges, decisions, requirementChanges, risks). Phase C: 5-classification analysis (gap/strength/out/buy/build). Implementer testimony via `DivergeConvergeOptions`.
- **Meeting Log**: `meeting-log.ts` — accumulates N session logs per standing committee → convergence detection (5-classification stability) → CPS generation (Context-Problem-Solution). 6 standing committees: Principles, Definitions, Structure, Architecture, Scope, Research Questions.
- **Amendment Protocol**: `amendment.ts` — legislative change management. `proposeAmendment()` → `voteOnAmendment()` → `resolveAmendment()`. Majority voting (>50% of eligible). Implementer has testimony but no vote. All amendments stored as parliament.amendment.* events.
- **Confluence Verification**: `confluence.ts` — post-audit whole-system integrity. 4 checks: Law↔Code (audit result), Part↔Whole (integration tests), Intent↔Result (CPS gaps), Law↔Law (amendment contradictions). Suggests amendments for mismatches.
- **Normal Form Convergence**: `normal-form.ts` — tracks Raw Output → Autofix → Manual Fix → Normal Form (100%). Per-provider convergence tracking. Conformance = fitness(40%) + audit pass rate(40%) + confluence(20%). Goal: any implementer converges to same Normal Form regardless of starting point.
- **Parliament CLI**: `quorum parliament "<topic>"` — runs 3-role diverge-converge deliberation. Auto-routes to standing committee. Supports `--rounds N`, `--committee`, `--advocate/--devil/--judge`, `--testimony`, `--force`, `--resume <id>`, `--history`, `--detail`. CPS persisted as `parliament.cps.generated` event + KV + `.claude/parliament/cps-*.md`. Gap classifications auto-propose amendments (Phase 4.5). Auditor availability pre-checked. Session checkpoint/resume via EventStore KV.
- **Parliament Config**: `config.json` `parliament` section: `convergenceThreshold`, `eligibleVoters`, `maxRounds`, `maxAutoAmendments`, `roles` (overrides consensus.roles). Priority: CLI flags > parliament.roles > consensus.roles > defaults.
- **CPS→Planner Pipeline**: Planner Phase 0 (CPS Intake) reads parliament CPS before Phase 1. CPS.Context→PRD §1, CPS.Problem→PRD §2, CPS.Solution→PRD §4. Skips Phase 1 if CPS covers full intent. Design Phase is mandatory for CPS-origin tracks (DRM must include Design row). Design before WB — Blueprint naming conventions are binding law.
- **Parliament Events**: `parliament.convergence` emitted per session (fixes TUI display). `parliament.debate.round` emitted for diverge/converge phases. `parliament.cps.generated` for CPS persistence. Normal-form report emitted as session.digest subType.
- **MECE Planner Phase**: Planner Phase 1.5 inserts Actor→System→Domain decomposition before PRD. Catches missing actors/systems that users don't mention. Phase 5.5 adds FDE failure checklists per FR before WB generation.
- **Stagnation FDE Loop**: 7-pattern detection (spinning, oscillation, no-drift, diminishing-returns, fitness-plateau, expansion, consensus-divergence). `auto-learn.ts` `learnFromStagnation()` feeds patterns back to `trigger.ts` (12 factors) for auto-escalation on future similar files.

## Testing

```bash
npm test                              # all (990+ tests)
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
node --test tests/hook-runner.test.mjs     # HookRunner engine + loader + bridge (43 tests)
node --test tests/multi-model-integration.test.mjs # 3-model integration: CLI adapters + NDJSON + hooks + consensus (23 tests)
node --test tests/parliament-e2e.test.mjs          # Parliament E2E pipeline (13 tests)
node --test tests/parliament-cli.test.mjs          # Parliament CLI arg parsing + routing (22 tests)
```
