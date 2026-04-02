# Harness Bootstrap Protocol

Generate a quorum-governed agent team tailored to the project's domain. Combines Harness's team design patterns with quorum's structural enforcement.

## Workflow

### Phase 1: Domain Analysis

1. Scan the project: tech stack, data models, key modules, test infrastructure
2. Identify core task types: generation, verification, editing, analysis, migration
3. Check existing quorum configuration: tracks, PRD, CPS, agents, skills
4. Detect language via `platform/core/languages/registry.mjs` for verify commands

### Phase 2: Team Architecture Design

Select an architecture pattern:

| Pattern | When to Use |
|---------|-------------|
| Pipeline | Sequential dependent phases |
| Fan-out/Fan-in | Parallel independent tasks with result aggregation |
| Producer-Reviewer | Generation followed by quality review (default for most projects) |
| Expert Pool | Context-dependent specialist selection |
| Supervisor | Dynamic task distribution based on progress |

Map to quorum's role system:

| Project Role | quorum Role | Responsibility |
|-------------|-------------|----------------|
| Builder/Developer | implementer | Code generation (headless) |
| Analyst/Researcher | scout | RTM gap analysis, dependency scanning |
| Reviewer/QA | self-checker | Mechanical verification (CQ, tests, lint, scope) |
| Architect/Designer | designer | Design documents, mermaid diagrams |
| Fixer | fixer | Targeted fixes from audit findings |

Ensure consensus coverage: the team must support advocate + devil + judge roles for audit.

### Phase 3: Agent Definition Generation

Generate agent files to `.claude/agents/{name}.md`. Each agent definition must include:
- **Role**: clear, specific responsibility
- **Principles**: constraints and guidelines
- **Protocol**: reference the appropriate `agents/knowledge/protocols/*.md`
- **Error handling**: what to do on failure
- **Team communication**: message targets and data passing

### Phase 4: Skill Generation

Generate skills as lightweight manifests referencing `agents/knowledge/`:
- YAML frontmatter: `name`, `description`, `knowledge` refs, `model`
- Body ≤ 20 lines — intent + knowledge references only
- Protocol knowledge stays in `agents/knowledge/`, not in the skill

### Phase 5: Integration with Quorum

1. Verify agent files are discoverable by AgentLoader (`.claude/agents/` path)
2. Validate consensus requirements: team must cover audit roles
3. If existing quorum track exists, link generated agents to track roles

### Phase 6: Validation

1. List generated files and verify structure
2. Check: each agent has a clear role, each skill has frontmatter
3. Verify: no adapter-specific tool names in canonical skills (protocol neutrality)
4. Report: team composition summary with role coverage matrix
