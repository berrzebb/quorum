# quorum

Cross-model audit gate with structural enforcement. Edit → audit → agree → retro → commit.

## Quick Commands

```bash
npm run build          # tsc compile
npm run typecheck      # tsc --noEmit
npm test               # node tests/run-suite.mjs all
npm run dev            # tsx daemon/index.ts
```

## Module Map

```
platform/cli/index.ts   ← quorum <command> dispatcher
  ├→ commands/setup.ts      ← project initialization
  ├→ commands/status.ts     ← gate status (--attach/--capture for mux remote view)
  ├→ commands/audit.ts      ← manual audit trigger
  ├→ commands/plan.ts       ← work breakdown listing (delegates to planning/ modules)
  ├→ commands/orchestrate.ts ← track orchestration (thin dispatcher → orchestrate/ library)
  ├→ commands/orchestrate/   ← compatibility shells (re-export from orchestrate/ library)
  │   ├→ shared.ts          ← re-exports planning types + functions (DIST, loadBridge, parseWorkBreakdown, etc.)
  │   ├→ planner.ts         ← re-exports auto-planner + CLI entry (interactivePlanner)
  │   ├→ runner.ts          ← re-exports execution + governance gates + CLI entry (runImplementationLoop)
  │   └→ lifecycle.ts       ← re-exports lifecycle hooks (autoRetro, autoMerge)
  ├→ commands/parliament.ts ← parliamentary deliberation CLI (topic → 3-role consensus → CPS)
  ├→ commands/ask.ts        ← provider direct query
  ├→ commands/tool.ts       ← MCP tool CLI
  ├→ commands/agent.ts      ← agent session management
  ├→ commands/merge.ts      ← squash-merge worktree branch into main
  ├→ commands/verify.ts     ← done-criteria checks (CQ, T, SEC, LEAK, DEP, SCOPE)
  ├→ commands/retro.ts      ← retrospective trigger
  ├→ commands/migrate.ts    ← legacy config migration
  └→ commands/doctor.ts     ← health check diagnostics

platform/orchestrate/    ← Orchestration library (extracted from monolithic runner.ts/shared.ts/planner.ts)
  ├→ index.ts             ← Root barrel (re-exports all 5 layers as namespaces)
  ├→ planning/            ← Legislation/blueprint generation (15 modules)
  │   ├→ index.ts          ← Barrel export
  │   ├→ types.ts          ← WorkItem, Wave, TrackInfo, PlanReviewResult, HeadingInfo, Bridge, MuxHandle
  │   ├→ track-catalog.ts  ← findTracks, resolveTrack, trackRef
  │   ├→ wb-heading-parser.ts ← parseHeading, classifyHeading, scanHeadings
  │   ├→ wb-field-parser.ts   ← parseFields, extractTargetFiles, extractDependsOn, etc.
  │   ├→ work-breakdown-parser.ts ← parseWorkBreakdown (assembled from heading + field parsers)
  │   ├→ plan-review.ts    ← reviewPlan (structural validation before execution)
  │   ├→ wave-graph.ts     ← computeWaves (topological wave computation)
  │   ├→ design-gates.ts   ← verifyDesignDiagrams (mermaid diagram verification)
  │   ├→ cps-loader.ts     ← findCPSFiles, loadCPS, loadPlannerProtocol
  │   ├→ planner-prompts.ts ← buildPlannerSystemPrompt, buildAutoPrompt, buildSocraticPrompt
  │   ├→ planner-mode.ts   ← determinePlannerMode (auto/socratic/inline)
  │   ├→ planner-session.ts ← runPlannerSession (high-level planner orchestration)
  │   ├→ auto-planner.ts   ← autoGenerateWBs, autoFixDesignDiagrams
  │   └→ contract-negotiation.ts ← validateNegotiation, approveWithNegotiation (pre-execution contract binding)
  ├→ execution/           ← Model routing, agent sessions, audit/fixer loops (13 modules)
  │   ├→ index.ts          ← Barrel export
  │   ├→ model-routing.ts  ← selectModelForTask (XS→haiku, S→sonnet, M→opus)
  │   ├→ dependency-context.ts ← buildDepContextFromManifests
  │   ├→ implementer-prompt.ts ← buildImplementerPrompt
  │   ├→ preflight.ts      ← runPreflightCheck, walkSourceFiles
  │   ├→ roster-builder.ts ← buildWaveRoster, canSpawnItem
  │   ├→ session-state.ts  ← WaveSessionState, ActiveSession, FailedItem
  │   ├→ agent-session.ts  ← spawnAgent, saveAgentState, captureAgentOutput, isAgentComplete
  │   ├→ audit-loop.ts     ← runWaveAuditGates
  │   ├→ fixer-loop.ts     ← runFixer, runFixCycle
  │   ├→ wave-runner.ts    ← runWave (single wave execution)
  │   ├→ wave-audit-llm.ts ← runWaveAuditLLM (LLM-based wave audit)
  │   └→ snapshot.ts       ← captureSnapshot, recordWaveManifest, readPreviousManifests
  ├→ governance/          ← RTM, phase gates, lifecycle, fitness, scope, confluence (12 modules)
  │   ├→ index.ts          ← Barrel export
  │   ├→ rtm-generator.ts  ← generateSkeletalRTM
  │   ├→ rtm-updater.ts    ← updateRTM, updateRTMContent
  │   ├→ phase-gates.ts    ← verifyPhaseCompletion, isWaveFullyCompleted, getRetryItems
  │   ├→ lifecycle-hooks.ts ← waveCommit, autoRetro, autoMerge, shouldTriggerRetro
  │   ├→ fitness-gates.ts  ← collectFitnessSignals, runFitnessGate, computeFitness
  │   ├→ scope-gates.ts    ← scanLines, scanForStubs, detectFileScopeViolations, etc. (13 gate functions)
  │   ├→ confluence-gates.ts ← runConfluenceCheck, proposeConfluenceAmendments
  │   ├→ e2e-verification.ts ← runE2EVerification
  │   ├→ adaptive-gate-profile.ts ← per-track gate threshold tuning
  │   ├→ iteration-budget.ts     ← max iteration/cost budget enforcement
  │   └→ runtime-evaluation-gate.ts ← runtime eval criteria checking
  ├→ state/               ← State contracts + filesystem stores
  │   ├→ index.ts          ← Barrel export
  │   ├→ state-types.ts    ← WaveCheckpoint, AgentSessionState, RTMEntry, RTMState
  │   ├→ state-port.ts     ← CheckpointPort, AgentStatePort, ManifestPort, RTMPort
  │   └→ filesystem/       ← Filesystem implementations
  │       ├→ checkpoint-store.ts ← FilesystemCheckpointStore
  │       ├→ agent-state-store.ts ← FilesystemAgentStateStore
  │       ├→ manifest-store.ts   ← FilesystemManifestStore
  │       ├→ rtm-store.ts        ← FilesystemRTMStore
  │       └→ track-file-store.ts ← resolveTrackDir, resolveDesignDir, resolveRTMPath, etc.
  └→ core/                ← Provider binary, mux, prompt I/O
      ├→ index.ts          ← Barrel export
      ├→ provider-binary.ts ← resolveProviderBinary, buildProviderArgs, prepareProviderSpawn
      ├→ provider-cli.ts   ← runProviderCLI
      ├→ mux-backend.ts    ← detectMuxBackend
      ├→ mux-session.ts    ← spawnMuxSession, pollMuxCompletion, cleanupMuxSession
      └→ prompt-files.ts   ← writePromptFile, writeScriptFile, cleanupPromptFiles

daemon/index.ts         ← Ink TUI entry point (StateReader + LockService injection)
  ├→ app.tsx            ← GateStatus + AgentPanel + FitnessPanel + TrackProgress + AuditStream + ItemStates + Locks + Specialists
  ├→ state-reader.ts    ← SQLite-only state reader (gates, items, locks, specialists, tracks, fitness)
  ├→ lib/               ← Shared utilities (progress-bar.ts, time.ts)
  ├→ shell/             ← App shell (density, focus-regions, navigation, shortcuts)
  ├→ panels/            ← overview/, review/, sessions/ panel components
  ├→ views/             ← chat-view, overview-view, operations-view, review-view
  ├→ services/          ← daemon-bootstrap, mux-lifecycle, provider-lifecycle
  ├→ state/             ← poller, render-control, snapshot, queries/
  └→ components/        ← GateStatus, AgentPanel, FitnessPanel, ParliamentPanel, AuditStream, TrackProgress, Header

platform/bus/
  ├→ bus.ts             ← QuorumBus (EventEmitter + SQLite/JSONL)
  ├→ store.ts           ← EventStore (SQLite WAL) + UnitOfWork + TransactionalUnitOfWork
  ├→ lock.ts            ← LockService (atomic SQL lock, replaces JSON lock files)
  ├→ claim.ts           ← ClaimService (per-file ownership for worktree conflict prevention)
  ├→ parallel.ts        ← ParallelPlanner (dependency-driven execution groups via graph coloring)
  ├→ orchestrator.ts    ← OrchestratorMode (5-mode auto-selection: serial/parallel/fan-out/pipeline/hybrid)
  ├→ auto-learn.ts      ← Auto-learning (repeat pattern detection + CLAUDE.md rule suggestions)
  ├→ projector.ts       ← MarkdownProjector (SQLite → markdown view generation)
  ├→ events.ts          ← 58 event types (incl. finding.*, fitness.*, parliament.*)
  ├→ message-bus.ts     ← MessageBus (finding-level SQLite communication, replaces file-based IPC)
  ├→ fitness.ts         ← Fitness score engine (7-component 0.0-1.0 quality metric)
  ├→ fitness-loop.ts    ← Autonomous fitness gate (proceed/self-correct/auto-reject)
  ├→ stagnation.ts      ← 7-pattern detection (incl. fitness-plateau, expansion, consensus-divergence)
  ├→ meeting-log.ts     ← Meeting log accumulation, 3-path convergence (exact/no-new-items/relaxed), noise filter, CPS generation
  ├→ amendment.ts       ← Amendment process (propose/vote/resolve, tiered voting: WB 50%, PRD/Design 66%, Scope 100%)
  ├→ confluence.ts      ← Confluence verification (4-point post-audit integrity: law-code/part-whole/intent-result/law-law)
  ├→ normal-form.ts     ← Normal form convergence tracking (raw-output → autofix → manual-fix → normal-form)
  ├→ parliament-gate.ts ← Enforcement gates (5 gates: amendment, verdict, confluence, design, regression)
  ├→ parliament-session.ts ← Parliament session orchestration (diverge-converge lifecycle)
  ├→ handoff-gate.ts    ← Artifact + evaluation contract validation (pre-handoff)
  ├→ promotion-gate.ts  ← Status change gates (role promotion/demotion rules)
  ├→ contract-enforcer.ts ← Contract breach detection (harness ↔ bus integration)
  ├→ blueprint-parser.ts ← Blueprint naming convention extraction for lint
  └→ mux.ts             ← ProcessMux (tmux/psmux/raw)

platform/providers/
  ├→ provider.ts        ← QuorumProvider + Auditor interfaces
  ├→ consensus.ts       ← DeliberativeConsensus (Advocate/Devil/Judge + Diverge-Converge)
  ├→ trigger.ts         ← 13-factor conditional trigger (12 base + interaction multipliers; T1/T2/T3)
  ├→ ast-analyzer.ts    ← TypeScript Compiler API wrapper (sourceFile + program mode, 5 analyzers + cross-file)
  ├→ router.ts          ← TierRouter (escalation/downgrade)
  ├→ agent-loader.ts    ← 4-tier persona resolution + LRU cache
  ├→ domain-detect.ts   ← Zero-cost domain detection (10 domains: perf, migration, a11y, security, ...)
  ├→ domain-router.ts   ← Conditional specialist activation (domain × tier)
  ├→ specialist.ts      ← Specialist review orchestrator (tools + agents → enriched evidence)
  ├→ claude-code/       ← ClaudeCodeProvider (hook-forwarding)
  ├→ codex/             ← CodexProvider (file-watch) + CodexAuditor + CodexPluginAuditor (codex-plugin-cc bridge)
  │   ├→ broker-detect.ts     ← isCodexPluginAvailable() — runtime detection of codex-plugin-cc
  │   ├→ plugin-bridge.ts     ← AuditRequest ↔ codex-plugin-cc format conversion (XML-tag prompts, structured output)
  │   ├→ plugin-auditor.ts    ← CodexPluginAuditor (delegates to codex-companion.mjs, auto-selected by factory)
  │   ├→ adversarial-review.ts ← Adversarial review wrapper (design decision challenge via codex-plugin-cc)
  │   ├→ background-job.ts    ← Background job submission/status/result/cancel via codex-plugin-cc
  │   └→ app-server/          ← [DEPRECATED v0.5.0] Direct JSON-RPC client (→ use codex-plugin-cc broker)
  ├→ harness/           ← Harness integration (revfactory/harness meta-skill bridge)
  │   ├→ team-mapper.ts       ← Harness roles → quorum 9-role mapping + consensus coverage validation
  │   ├→ skill-mapper.ts      ← Harness skills → quorum canonical format (neutrality check, Progressive Disclosure)
  │   └→ workspace-bridge.ts  ← Harness _workspace/ → quorum bus events (artifact discovery + handoff)
  ├→ auditors/          ← Auditor implementations (claude, codex, gemini, ollama, openai, openai-compatible, vllm, mux, parse)
  │   ├→ factory.ts     ← createConsensusAuditors() — auto-selects CodexPluginAuditor when codex-plugin-cc available
  │   └→ structured-schema.ts ← JSON Schema for structured audit verdicts (opinion + judge schemas)
  └→ evaluators/        ← Runtime evaluation probes (cli-session, api-probe, data-probe, artifact-validator, browser-playwright)
      └→ evaluator-port.ts ← Evaluator interface

platform/core/
  ├→ bridge.mjs         ← MJS hooks ↔ TS modules bridge (+ domain/specialist/claim/orchestrator routing)
  ├→ context.mjs        ← config, paths, parser, i18n, refreshConfigIfChanged
  ├→ cli-runner.mjs     ← cross-platform spawn (resolveBinary, execResolved, gitSync)
  ├→ audit.mjs          ← re-export shim → core/audit/ modules
  ├→ audit/             ← split audit modules (args, session, scope, pre-verify, codex-runner, solo-verdict, index)
  ├→ respond.mjs        ← Event Reactor (SQLite verdict → side-effects only, no markdown)
  ├→ enforcement.mjs    ← structural enforcement
  ├→ markdown-table-parser.mjs ← Shared pipe-split table parser (8 consumers)
  ├→ tools/             ← 26 MCP tools, each in own directory
  │   ├→ registry.mjs    ← Tool registry: getAllTools, getTool, executeTool, categories
  │   ├→ tool-utils.mjs  ← Shared utilities (safePath, walkDir, parseFile, runPatternScan, cache)
  │   ├→ mcp-server.mjs  ← MCP JSON-RPC transport (schema + dispatch from registry)
  │   ├→ {tool-name}/index.mjs ← 24 individual tool directories
  │   └→ ast-bridge.mjs  ← Fail-safe MJS↔AST bridge (hybrid scanning)
  └→ harness/           ← Execution contracts (8 modules)
      ├→ contract-ledger.ts      ← Contract lifecycle tracking
      ├→ evaluation-contract.ts  ← Evaluation criteria contracts
      ├→ handoff-artifact.ts     ← Artifact handoff validation
      ├→ iteration-policy.ts     ← Iteration budget policies
      ├→ negotiation-record.ts   ← Contract negotiation audit trail
      ├→ quality-rubric.ts       ← Quality scoring rubrics
      ├→ runtime-evaluation-spec.ts ← Runtime eval specifications
      └→ sprint-contract.ts      ← Sprint-level contract bindings

platform/core/languages/
  ├→ registry.mjs       ← LanguageRegistry (auto-discover + fragment merge, CORE_FIELDS enforcement)
  ├→ typescript/         ← spec.mjs (core + verify commands) + spec.{symbols,imports,perf,a11y,compat,observability,doc}.mjs
  ├→ go/                 ← spec.mjs + verify + 7 fragments (symbols, imports, perf, security, observability, compat, doc)
  ├→ python/             ← spec.mjs + verify + 7 fragments
  ├→ rust/               ← spec.mjs + verify + 7 fragments
  └→ java/               ← spec.mjs + verify + 7 fragments

agents/knowledge/          ← Single source of truth for all domain knowledge (178 files)
  ├→ protocols/              ← 25 procedural protocols (planner, orchestrator, verify, fixer, ...)
  ├→ domains/                ← 11 domain expertise files (perf, a11y, security, ...)
  ├→ tools/inventory.md      ← 26-tool catalog
  ├→ references/             ← Progressive Disclosure material (77 files)
  └→ scripts/                ← Executable assets (export scripts, 63 files)

platform/skills/          ← Core skill manifests (11 lightweight files, avg ~20 lines)
  ├→ ARCHITECTURE.md     ← Knowledge-centric architecture (v0.6.0)
  └→ {skill}/SKILL.md   ← Intent + knowledge refs (no protocol content)

platform/adapters/shared/  ← Adapter-agnostic business logic (20 modules)

platform/adapters/claude-code/
  ├→ index.mjs          ← PostToolUse hook (trigger eval + domain routing + specialist tools + bridge)
  ├→ session-gate.mjs   ← PreToolUse (retro enforcement, SQLite KV + JSON fallback)
  ├→ hooks/hooks.json   ← 22 hook registrations (full spec: incl. PermissionRequest, Notification, ConfigChange, Elicitation)
  ├→ agents/            ← 13 agents (incl. doc-sync; reference agents/knowledge/ + Claude Code tool bindings)
  └→ commands/          ← 10 CLI shortcuts (incl. cl-docs)

platform/adapters/gemini/
  ├→ gemini-extension.json ← extension manifest (MCP server registration)
  ├→ hooks/hooks.json      ← 11 hook registrations (full spec: incl. AfterAgent, BeforeModel, AfterModel, PreCompress, Notification)
  └→ commands/             ← 4 TOML commands

platform/adapters/codex/
  ├→ hooks/hooks.json      ← 5 hook registrations (SessionStart, Stop, UserPromptSubmit, AfterAgent, AfterToolUse)
  ├→ hooks/plugin-hooks.json ← codex-plugin-cc integration hooks (Stop review gate, appended after quorum hooks)
  └→ hooks/scripts/stop-review-gate.mjs ← Codex stop-time review gate (fitness check → codex companion → ALLOW/BLOCK)

platform/adapters/openai-compatible/
  └→ agents/               ← 13 agents (mirror of claude-code agents)

platform/adapters/shared/
  ├→ skill-resolver.mjs   ← Dynamic skill composition (manifest + protocol + tool mapping)
  └→ tool-names.mjs       ← Adapter tool name registry (canonical → native)
```

## Key Patterns

- **Bridge**: `platform/core/bridge.mjs` connects MJS hooks to compiled TS modules. Fail-safe via `withFallback(fn, default, context)` pattern. 10 namespace exports (claim, lock, agent, parliament, domain, event, query, gate, hooks, execution). Single `_svc` service container for 14 lazy singletons. Callers use `bridge.event.emitEvent()` namespace API.
- **Tool Registry**: `platform/core/tools/registry.mjs` — single entry point for 26 MCP tools. `getAllTools()`, `getTool(name)`, `executeTool(name, args)`. Each tool lives in `tools/{name}/index.mjs`. Heavy tools (fvm-generate, fvm-validate, contract-drift) lazy-loaded on first call. Schemas + dispatch unified. `tool-core.mjs` deleted — all consumers migrated to registry or individual tool dirs.
- **Consensus Gate**: evidence → trigger eval → domain detection → specialist tools → T1 skip / T2 simple / T3 deliberative → verdict → retro → commit.
- **SQLite Unified State**: `state_transitions`, `locks`, `kv_state` tables + `events` — single source of truth. No verdict files (verdict.md/gpt.md eliminated). `audit-status.json` marker for fast-path hook detection.
- **Domain Specialists**: Zero-cost file pattern matching → 22 deterministic tools + domain-specific LLM agents activated conditionally per domain × tier. 11 domains: perf, a11y, compat, compliance, concurrency, docs, i18n, infra, observability, migration, security.
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
- **3-Layer Adapter**: I/O (adapter-specific stdin/stdout) + Business logic (`platform/adapters/shared/`) + Bridge (`platform/core/`). New adapter = I/O wrappers only (~650 lines vs ~2,000).
- **Knowledge-Centric Skills**: `agents/knowledge/` is the single source of truth for all protocols, domains, and references (178 files). Skills are lightweight manifests (~20 lines) that reference knowledge. `skill-resolver.mjs` composes protocol + tool mapping at runtime. No static adapter wrappers — 4 adapters resolved dynamically via `tool-names.mjs`. See `agents/knowledge/README.md`.
- **Fragment-Only Language Specs**: `platform/core/languages/registry.mjs` enforces `CORE_FIELDS` whitelist. `spec.mjs` = metadata only. Domain data (symbols, imports, qualityRules) MUST be in `spec.{domain}.mjs` fragments. No inline fallback.
- **Adapter Env Fallback**: `platform/core/context.mjs` resolves `QUORUM_ADAPTER_ROOT` → `CLAUDE_PLUGIN_ROOT` → `GEMINI_EXTENSION_ROOT` for config, locales, plugin paths.
- **Tool Name Mapping**: `platform/adapters/shared/tool-names.mjs` maps canonical operations (bash, read, write) to adapter-native names (Bash/shell, Read/read_file, Write/write_file).
- **HookRunner Engine**: `platform/adapters/shared/hook-runner.mjs` — generic hook execution engine (ported from SoulFlow). command/http handlers, env interpolation, deny-first-break, async fire-and-forget, matcher filtering. `hook-loader.mjs` loads from HOOK.md YAML or JSON config. `hook-bridge.mjs` adapts to PreToolHook/PostToolHook/AuditGate interfaces.
- **NDJSON Wire Protocol**: `ndjson-parser.mjs` + `cli-adapter.mjs` — stream-based NDJSON parsing for 3 CLI formats (Claude stream-json, Codex exec --json, Gemini stream-json). Unified `AgentOutputMessage` type (assistant_chunk, tool_use, tool_result, complete, error). Factory: `createCliAdapter("claude"|"codex"|"gemini")`.
- **JSON-RPC Client**: `jsonrpc-client.mjs` — stdio JSON-RPC 2.0 client for Codex app-server mode. Bidirectional: client requests + server-initiated requests + notifications. 10MB buffer guard, request timeout, auto-reject on process exit.
- **SDK Tool Bridge**: `sdk-tool-bridge.mjs` — JSON Schema → Zod conversion for Claude Agent SDK native tool loops. Optional dependency (`@anthropic-ai/claude-agent-sdk` + `zod`). Returns null if unavailable.
- **MuxAdapter**: `mux-adapter.mjs` — bridges ProcessMux (tmux/psmux) sessions with CliAdapter/NdjsonParser. `spawn()` creates a CLI session per model, `send()` writes prompts via mux, `capture()` parses NDJSON output. `spawnConsensus()` + `awaitConsensus()` for 3-model deliberative protocol.
- **Doc-Sync**: `agents/knowledge/protocols/doc-sync.md` — extracts facts from code (hook counts, tool counts, test counts, versions) and fixes numeric mismatches + section parity gaps in 8 doc files. 3-adapter aware (counts all adapters). Runs automatically in merge-worktree Phase 2.5 before squash commit.
- **Skill Architecture**: `platform/skills/ARCHITECTURE.md` — knowledge-centric model: `agents/knowledge/` (single source) → `platform/skills/` (11 core manifests) → `skill-resolver.mjs` (dynamic adapter composition). No static adapter wrappers. On-demand skills generated by `harness-bootstrap` from knowledge base.
- **Diverge-Converge Consensus**: `consensus.ts` `runDivergeConverge()` — Parliament-style deliberation. Phase A: free divergence (no role constraints, all speak freely). Phase B: Judge converges into 4 MECE registers (statusChanges, decisions, requirementChanges, risks). Phase C: 5-classification analysis (gap/strength/out/buy/build). Implementer testimony via `DivergeConvergeOptions`.
- **Meeting Log**: `meeting-log.ts` — accumulates N session logs per standing committee → 3-path convergence detection → CPS generation (Context-Problem-Solution). 6 standing committees: Principles, Definitions, Structure, Architecture, Scope, Research Questions. Three convergence paths (any triggers): **exact** (delta=0, mature projects), **no-new-items** (item set subset, greenfield), **relaxed** (delta ≤ 30% of items, LLM non-determinism). `filterNoiseLogs()` skips parse-fallback rounds (>50% item drop). `logTimestamp` in event payload preserves insertion order.
- **Amendment Protocol**: `amendment.ts` — legislative change management. `proposeAmendment()` → `voteOnAmendment()` → `resolveAmendment()`. Majority voting (>50% of eligible). Implementer has testimony but no vote. All amendments stored as parliament.amendment.* events.
- **Confluence Verification**: `confluence.ts` — post-audit whole-system integrity. 4 checks: Law↔Code (audit result), Part↔Whole (integration tests), Intent↔Result (CPS gaps), Law↔Law (amendment contradictions). Suggests amendments for mismatches.
- **Normal Form Convergence**: `normal-form.ts` — tracks Raw Output → Autofix → Manual Fix → Normal Form (100%). Per-provider convergence tracking. Conformance = fitness(40%) + audit pass rate(40%) + confluence(20%). Goal: any implementer converges to same Normal Form regardless of starting point.
- **Parliament CLI**: `quorum parliament "<topic>"` — runs 3-role diverge-converge deliberation. Auto-routes to standing committee. Supports `--rounds N`, `--committee`, `--advocate/--devil/--judge`, `--testimony`, `--force`, `--resume <id>`, `--history`, `--detail`. CPS persisted as `parliament.cps.generated` event + KV + `.claude/parliament/cps-*.md`. Gap classifications auto-propose amendments (Phase 4.5). Auditor availability pre-checked. Session checkpoint/resume via EventStore KV.
- **Parliament Config**: `config.json` `parliament` section: `convergenceThreshold`, `eligibleVoters`, `maxRounds`, `maxAutoAmendments`, `roles` (overrides consensus.roles). Priority: CLI flags > parliament.roles > consensus.roles > defaults.
- **CPS→Planner Pipeline**: Planner Phase 0 (CPS Intake) reads parliament CPS before Phase 1. CPS.Context→PRD §1, CPS.Problem→PRD §2, CPS.Solution→PRD §4. Skips Phase 1 if CPS covers full intent. Design Phase is mandatory for CPS-origin tracks (DRM must include Design row). Design before WB — Blueprint naming conventions are binding law.
- **Parliament Events**: `parliament.convergence` emitted per session (fixes TUI display). `parliament.debate.round` emitted for diverge/converge phases. `parliament.cps.generated` for CPS persistence. Normal-form report emitted as session.digest subType.
- **Parliament Enforcement Gates**: `platform/bus/parliament-gate.ts` — 5 structural gates that BLOCK work: Amendment gate, Verdict gate, Confluence gate, Design gate, Regression gate. `checkAllGates()` runs all at once. `quorum merge --force` to bypass. Bridge exports all gate functions.
- **MuxAuditor**: `providers/auditors/mux.ts` — Auditor implementation backed by ProcessMux (tmux/psmux). `--mux` flag in parliament CLI spawns LLM sessions as mux panes. Sessions saved to `.claude/agents/` (daemon-discoverable). `createMuxConsensusAuditors()` creates 3 mux-backed auditors sharing one ProcessMux instance. Daemon TUI shows live sessions (role, backend, age).
- **Parliament Session Observability**: Daemon `ParliamentPanel` shows: live mux sessions (LIVE section with role/backend/age), committee convergence, pending amendments, Normal Form conformance, session count.
- **Blueprint Naming Lint**: `quorum tool blueprint_lint` — parses Blueprint "Naming Conventions" tables from `design/` markdown, generates violation patterns (PascalCase/camelCase/suffix alternatives), scans source files. `platform/bus/blueprint-parser.ts` extracts rules. Violations are `high` severity. Enforces `impl(A, law) = impl(B, law)` by detecting non-compliant identifiers.
- **Wave Execution**: `quorum orchestrate run <track> --provider claude [--concurrency N] [--resume]` — Wave-based implementation loop with 21-gate chain. `computeWaves()` groups WBs by Phase gates (topological sort on `dependsOn`). Each Wave: implementer → self-checker (haiku) → 21 gates → audit. On audit failure, Fixer agent applies targeted fixes (max 3 rounds). `--resume` loads `.claude/quorum/wave-state-{track}.json` to skip completed waves and retry failed items. Post-audit: confluence check + project tests. Events: agent.spawn, track.progress, track.complete.
- **MECE Planner Phase**: Planner Phase 1.5 inserts Actor→System→Domain decomposition before PRD. Catches missing actors/systems that users don't mention. Phase 5.5 adds FDE failure checklists per FR before WB generation.
- **Stagnation FDE Loop**: 7-pattern detection (spinning, oscillation, no-drift, diminishing-returns, fitness-plateau, expansion, consensus-divergence). `auto-learn.ts` `learnFromStagnation()` feeds patterns back to `trigger.ts` (13 factors) for auto-escalation on future similar files.
- **Plan Review Gate**: `reviewPlan()` validates WBs before `orchestrate run`. Action + Verify fields required — blocks execution if missing. Guards: >5 target files → split. GATE-N references resolved to Phase parent index (valid if index < parent count). Unknown external deps are warnings, not errors.
- **Wave Grouping**: `computeWaves()` in `shared.ts` — Phase parents define gate boundaries (Phase N must complete before Phase N+1). Within a phase, `dependsOn` topological sort creates sub-waves. Items at the same depth run in parallel. `--concurrency` caps simultaneous agents.
- **Role Delegation**: Implementer writes code only. Self-checking delegated to `self-checker` (haiku, deterministic tools). Corrections delegated to `fixer` (sonnet). Orchestrator dispatches via `[DELEGATION]` hint. 9 roles total: wb-parser, rtm-scanner, scout, designer, fde-analyst, implementer, self-checker, fixer, gap-detector.
- **Fixer Role**: `runFixer()` in `runner.ts` — spawned when Wave audit fails or self-checker fails. Receives specific audit findings + affected files + fitness context. Applies targeted fixes without rewriting (different from Implementer). Single-turn `claude -p` with `--dangerously-skip-permissions`.
- **Self-Checker Role**: Haiku-tier deterministic-only verification: CQ, T, lint, scope, blast-radius. No LLM judgment — mechanical pass/fail. Spawned by orchestrator after implementer completes. On failure → fixer → re-check.
- **Governance Modules**: `platform/orchestrate/governance/` — 21-gate chain extracted from monolithic runner.ts. fitness-gates, scope-gates (13 functions), confluence-gates, lifecycle-hooks, phase-gates, rtm-updater, rtm-generator, adaptive-gate-profile, iteration-budget, runtime-evaluation-gate. Each gate is independently testable.
- **Planning Modules**: `platform/orchestrate/planning/` — track-catalog, work-breakdown-parser, cps-loader, planner-prompts, planner-session, contract-negotiation. Planner.ts is now a thin wrapper dispatching to `runPlannerSession()`.
- **Harness Contracts**: `platform/core/harness/` — 8 modules defining execution contracts: contract-ledger (lifecycle tracking), evaluation-contract (criteria), handoff-artifact (validation), iteration-policy (budget), quality-rubric (scoring). `platform/bus/contract-enforcer.ts` detects breaches.
- **Evaluator Probes**: `platform/providers/evaluators/` — runtime evaluation framework. cli-session (terminal probes), api-probe (HTTP probes), data-probe (DB probes), artifact-validator (file output checks), browser-playwright (UI verification). `evaluator-port.ts` defines the interface.
- **Handoff/Promotion Gates**: `platform/bus/handoff-gate.ts` validates artifact + evaluation contracts before role transitions. `platform/bus/promotion-gate.ts` enforces status change rules (role promotion/demotion).
- **Parliament Session**: `platform/bus/parliament-session.ts` — full diverge-converge lifecycle orchestration. Manages round progression, convergence detection, and session state.
- **Platform-Only Layout**: All source code lives under `platform/` (7 layers: cli, orchestrate, bus, providers, core, adapters, skills). Root has no source — only `daemon/`, `languages/`, `agents/knowledge/`, `tests/` remain at root as build/runtime/shared concerns.
- **Wave State Persistence**: `wave-state-{track}.json` saved after each Wave. Contains `completedIds`, `failedIds`, `lastCompletedWave`, `totalItems`, `lastFitness`, `totalWaves`. `--resume` flag loads state, skips completed waves, retries failed items. Survives process crashes and computer restarts.
- **Design Auto-Fix**: `autoFixDesignDiagrams()` in `planner.ts` — spawns fresh `claude -p` per attempt (not mux multi-turn). Includes exact file paths in prompt. Infinite retry loop for mermaid diagram generation.
- **Model Tier Routing**: `selectModelForTask()` in `runner.ts` — XS→haiku, S→sonnet, M→opus. WB Size parsed from heading. Domain detection feeds into tier selection. `--model` flag auto-appended to CLI args.
- **Language Verify Commands**: `languages/{lang}/spec.mjs` now exports `verify` field with CQ/T/TEST/DEP commands + `detect` arrays. Self-checker uses these instead of hardcoded commands. Example: TypeScript → `npx eslint`, `npx tsc --noEmit`, `npm test`, `npm audit`.
- **Amendment Tiered Voting**: WB: 50% simple majority, PRD: 66% super-majority, Design: 66% super-majority, Scope: 100% unanimous. Prevents lightweight votes from changing project boundaries.
- **Specialist Confidence Filter**: `specialist-base.md` — confidence ≥ 0.8 to report, max 10 findings per review, per-finding confidence scores. `findingsSummary` tracks filtered count. High-severity findings can mark `"escalation": "block"`.
- **Parliamentary Checkpoints**: 5 decision gates during orchestration: requirement confirmation, design choice, implementation scope, quality verdict, convergence decision. Tier determines which are active (T1: skip all, T2: 2 checkpoints, T3: all 5).
- **Consensus Checklist**: Advocate (5 items), Devil's Advocate (6 items), Judge (explicit decision procedure). All verdicts must include file:line evidence. Tie-breaking: both approved→approved, both rejected→rejected, split→check agreement, neither→reject (fail-safe).
- **Trigger Interaction Multipliers**: Factor 13 — high-risk co-occurrence (security×blast-radius ×1.3, security×cross-layer ×1.2, cross-layer×API ×1.15, rejection×stagnation ×1.25). `Math.max` prevents multiplier explosion.
- **Evidence via SQLite**: `audit_submit` MCP tool replaces watch_file markdown. Evidence stored in EventStore, trigger evaluated inline. Hooks read from `tool_input.content`, not file. `readWatchContent()` eliminated.
- **Codex Plugin Integration**: `codex-plugin-cc` (openai/codex-plugin-cc) optional peer dependency. `isCodexPluginAvailable()` runtime detection → `CodexPluginAuditor` auto-selected by factory. Falls back to `CodexAuditor` (direct CLI) when unavailable. Structured output schemas eliminate `extractJson` fallback. Adversarial review wraps codex-plugin-cc's challenge review as 4th consensus opinion.
- **Harness Integration**: `revfactory/harness` optional peer dependency. `harness-bootstrap` meta-skill generates quorum-governed agent teams. `team-mapper.ts` maps 30+ Harness roles → quorum 9-role system with auto-supplementation. `skill-mapper.ts` enforces protocol neutrality + Progressive Disclosure. AgentLoader discovers Harness-generated agents via `.claude/agents/` (no code change needed).
- **Stop Review Gate**: `stop-review-gate.mjs` hook fires on session Stop. Two gates: fitness score threshold (mechanical) + codex-plugin-cc adversarial review (LLM). Fail-open on error. Enabled via `config.stopReviewGate.enabled`.
- **Structured Verdict Schema**: `structured-schema.ts` defines JSON Schemas for advocate/devil opinions and judge verdicts. `parseOpinion()` and `parseJudgeVerdict()` use schema-first fast path (skip `extractJson` when structured output available), with existing fallback chain preserved.
- **Hook Coexistence**: `mergeHookConfigs()` in hook-bridge.mjs ensures quorum hooks fire before plugin hooks. `hookRunnerToStopReviewGate()` bridges Stop hooks with fitness scoring.
- **Background Jobs**: `background-job.ts` wraps codex-plugin-cc's detached job system. `submitBackgroundJob()` / `queryJobStatus()` / `getJobResult()` / `cancelJob()` for long-running audits.

## Testing

```bash
npm test                              # all (2412 tests)
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
node --test tests/parliament-cli.test.mjs          # Parliament CLI arg parsing + routing (28 tests)
node --test tests/parliament-gate.test.mjs         # Parliament enforcement gates (16 tests)
node --test tests/blueprint-lint.test.mjs          # Blueprint naming convention lint (12 tests)
node --test tests/wave-gates.test.mjs             # 21-gate chain (scope, blueprint, perf, dep, orphan, test-file)
node --test tests/platform-only-layout.test.mjs   # platform/ directory structure validation
node --test tests/platform-path-compat.test.mjs   # platform/ path compatibility (imports, aliases)
node --test tests/contract-enforcer.test.mjs      # Contract breach detection
node --test tests/contract-negotiation.test.mjs   # Contract negotiation lifecycle
node --test tests/handoff-gate.test.mjs           # Handoff artifact/evaluation gate
node --test tests/runtime-evaluation-gate.test.mjs # Runtime evaluation criteria gate
node --test tests/adaptive-gate-profile.test.mjs  # Per-track gate threshold tuning
```
