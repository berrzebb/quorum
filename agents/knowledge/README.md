# agents/knowledge/ — Quorum Knowledge Base

## Purpose

Single source of truth for all domain knowledge, protocols, and reference material.
Harness reads this directory to dynamically compose skills and agents on demand.

**Knowledge change here = 1 file edit = all generated skills reflect. No duplication.**

## Why Root (Not Under `platform/`)

`agents/knowledge/` contains Markdown protocol definitions and reference documents —
consumed by LLM agents at prompt-construction time, never compiled or executed.
`platform/` contains compiled TypeScript and MJS modules that Node.js runs.

## Structure

```
agents/knowledge/
├── protocols/          ← Procedural knowledge (25 protocols)
│   ├── planner.md         Pipeline: 8-phase PRD protocol
│   ├── orchestrator.md    Pipeline: task distribution + agent dispatch
│   ├── audit.md           Pipeline: cross-model review trigger
│   ├── verify.md          Pipeline: 8-check done criteria
│   ├── status.md          Pipeline: state visibility
│   ├── merge-worktree.md  Pipeline: squash-merge commit flow
│   ├── harness-bootstrap.md Pipeline: dynamic team/skill generation
│   ├── consensus-tools.md Pipeline: 20 MCP tool interface
│   ├── fde-analyst.md     Requirement: failure-driven analysis
│   ├── wb-parser.md       Requirement: WB → structured table
│   ├── designer.md        Requirement: design document generation
│   ├── implementer.md     Execution: code-only worker protocol
│   ├── fixer.md           Execution: surgical fix from findings
│   ├── convergence-loop.md Execution: evaluate→fix cycle
│   ├── scout.md           Verification: RTM gap analysis
│   ├── rtm-scanner.md     Verification: tool-based tracing
│   ├── gap-detector.md    Verification: design↔code comparison
│   ├── specialist-base.md Verification: domain reviewer base
│   ├── ui-review.md       Verification: browser-based UI check
│   ├── parliament-rules.md Governance: deliberation rules
│   ├── doc-sync.md        Maintenance: 3-layer doc sync
│   ├── retrospect.md      Maintenance: learning extraction
│   ├── rollback.md        Maintenance: checkpoint recovery
│   ├── export.md          Output: multi-format document generation
│   └── mermaid.md         Output: 13-type diagram generation
│
├── domains/            ← Domain expertise (11 domains)
│   ├── a11y.md            Accessibility
│   ├── compat.md          Cross-platform compatibility
│   ├── compliance.md      Regulatory compliance
│   ├── concurrency.md     Concurrency and parallelism
│   ├── docs.md            Documentation quality
│   ├── i18n.md            Internationalization
│   ├── infra.md           Infrastructure and deployment
│   ├── migration.md       Migration and upgrade paths
│   ├── observability.md   Logging, tracing, metrics
│   ├── perf.md            Performance optimization
│   └── security.md        Security hardening
│
├── tools/              ← Tool catalog
│   └── inventory.md       26 deterministic analysis tools
│
├── references/         ← Progressive Disclosure material
│   ├── planner/           13 document templates (PRD, WB, MECE, ...)
│   ├── orchestrator/      5 phase guides (tiers, distribution, ...)
│   ├── consensus-tools/   21 per-tool references
│   ├── mermaid/           16 diagram type references
│   ├── export/            PDF/PPTX/DOCX/HTML format guides
│   ├── designer/          Design phase templates
│   ├── doc-sync/          3-layer sync guides
│   ├── retrospect/        Gathering/execution/candidates
│   ├── commit-convention/ Types, body guide, split patterns
│   ├── mcp-builder/       Node/Python MCP server guides
│   └── verify/            Check details
│
└── scripts/            ← Executable assets
    └── export/            PDF/PPTX/DOCX/HTML generation scripts
```

## Design Rules

1. **Protocols are self-contained.** A protocol must not require reading another protocol to be useful. Shared concepts (tool invocation, verdict flow) are stated inline, not referenced.

2. **Knowledge changes require audit.** Protocol modifications affect all generated skills. Treat protocol edits with the same rigor as code changes — cross-model review applies.

3. **References are Progressive Disclosure.** Protocols point to `references/` for detailed guides. Agents load references only when needed, keeping base context small.

4. **Domains are additive.** New domain = new file in `domains/`. No other changes needed — harness discovers and composes automatically.

5. **Scripts are executable assets.** Python/Node scripts in `scripts/` are invoked by agents, not loaded into context. They provide deterministic operations (PDF generation, PPTX creation) that LLMs should not attempt inline.

## How Harness Uses This

```
requirement → harness analyzes domain
           → selects protocols/ (procedural knowledge)
           → selects domains/ (domain expertise)
           → selects references/ (detailed guides, on demand)
           → composes skill manifest (10-line YAML)
           → resolves adapter tool names (tool-names.mjs)
           → agent executes with composed context
```

## Inheritance (Simplified)

```
agents/knowledge/     ← Knowledge (this directory)
        ↓ composed by
harness-bootstrap     ← Skill generator (dynamic)
        ↓ produces
runtime skill         ← Manifest + knowledge refs (ephemeral)
        ↓ resolved by
tool-names.mjs        ← Adapter tool mapping (mechanical)
```
