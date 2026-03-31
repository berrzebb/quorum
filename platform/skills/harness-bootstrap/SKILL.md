---
name: quorum:harness-bootstrap
description: "Bootstrap a quorum-governed agent team for any project. Analyzes the domain, designs team architecture, generates agents and skills with quorum quality gates built in. Use when setting up a new project, onboarding a new domain, or restructuring an existing team. Triggers on: 'harness 구성', 'harness 구축', 'set up harness', 'bootstrap harness', 'build a harness'."
---

# Harness Bootstrap — Agent Team & Skill Architect for Quorum

Generate a quorum-governed agent team tailored to the project's domain.
Combines Harness's team design patterns with quorum's structural enforcement.

## Workflow

### Phase 1: Domain Analysis

1. Scan the project: tech stack, data models, key modules, test infrastructure
2. Identify core task types: generation, verification, editing, analysis, migration
3. Check existing quorum configuration: tracks, PRD, CPS, agents, skills
4. Detect language via `platform/core/languages/registry.mjs` for verify commands

### Phase 2: Team Architecture Design

Select an architecture pattern based on the project's needs:

| Pattern | When to Use |
|---------|-------------|
| Pipeline | Sequential dependent phases (e.g., analyze → implement → test) |
| Fan-out/Fan-in | Parallel independent tasks with result aggregation |
| Producer-Reviewer | Generation followed by quality review (default for most projects) |
| Expert Pool | Context-dependent specialist selection |
| Supervisor | Dynamic task distribution based on progress |

Map to quorum's role system:

| Project Role | quorum Role | Responsibility |
|-------------|-------------|----------------|
| Builder/Developer | implementer | Code generation (headless, no human interaction) |
| Analyst/Researcher | scout | RTM gap analysis, dependency scanning |
| Reviewer/QA | self-checker | Mechanical verification (CQ, tests, lint, scope) |
| Architect/Designer | designer | Design documents, mermaid diagrams |
| Fixer | fixer | Targeted fixes from audit findings |

Ensure consensus coverage: the team must support advocate + devil + judge roles for audit.

### Phase 3: Agent Definition Generation

Generate agent files to `.claude/agents/{name}.md`:

Each agent definition must include:
- **Role**: clear, specific responsibility
- **Principles**: constraints and guidelines
- **Protocol**: input/output format, tool usage
- **Error handling**: what to do on failure
- **Team communication**: message targets and data passing (if team mode)

Reference quorum protocols where applicable:
- Implementer agents → `agents/knowledge/implementer-protocol.md`
- Specialist agents → `agents/knowledge/specialist-base.md` + domain file
- Scout agents → `agents/knowledge/scout-protocol.md`

### Phase 4: Skill Generation

Generate skills to `.claude/skills/{name}/skill.md`:

Follow quorum's canonical skill structure:
- YAML frontmatter: `name` (required), `description` (required, aggressive trigger)
- Body: ≤500 lines, imperative voice, explain WHY not just WHAT
- References: split into `references/` when body approaches 500 lines

Follow Progressive Disclosure:
1. Metadata (~100 words) — always in context
2. skill.md (<500 lines) — loaded on trigger
3. references/ — loaded on demand

### Phase 5: Integration with Quorum

1. Run `quorum tool skill_sync --mode fix` to generate adapter wrappers for all 4 platforms
2. Verify agent files are discoverable by `AgentLoader` (check `.claude/agents/` path)
3. Validate consensus requirements: team must cover audit roles
4. If existing quorum track exists, link generated agents to track roles

### Phase 6: Validation

1. List generated files and verify structure
2. Check: each agent has a clear role, each skill has frontmatter
3. Verify: no adapter-specific tool names in canonical skills (protocol neutrality)
4. Report: team composition summary with role coverage matrix
