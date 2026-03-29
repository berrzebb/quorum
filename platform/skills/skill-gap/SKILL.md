---
name: quorum:skill-gap
description: "Analyze CPS/PRD to identify which skills and tools are needed for a track. Compares requirements against the skill catalog to find COVERED/PARTIAL/GAP status. Single responsibility: skill need identification. Triggers on 'skill gap', 'what skills needed', 'analyze needs', '스킬 갭', '필요 스킬', '어떤 도구가 필요해'."
argument-hint: "<track name or CPS/PRD path>"
context: fork
mergeResult: false
permissionMode: plan
memory: none
skills: []
tools:
  - read
  - glob
  - grep
hooks: {}
---

# Skill Gap Analyzer

Read CPS/PRD documents and identify which quorum skills and tools are needed for the track. Produces a gap analysis against the current skill catalog.

## Pipeline Phase

| Phase | Role | Active |
|-------|------|--------|
| 1. Parliament | Consumes CPS for technical signals | input |
| 2. **Planning** | **Analyzes PRD/CPS to identify needed skills and tools** | **✅ primary** |
| 3. Design | — | — |
| 4. Implementation | — | — |
| 5. Verification | — | — |
| 6. Audit | — | — |
| 7. Convergence | — | — |
| 8. Retrospective | — | — |

Runs early in the pipeline to ensure all needed capabilities are available.

## Model Selection

Runs on **haiku** — pattern matching between requirements and skill descriptions. No deep reasoning needed.

## Input

- **CPS file** from Parliament (`.claude/parliament/cps-*.md`)
- Or **PRD** from Planner (`{planning_dir}/PRD.md`)
- Or **Work Breakdown** for more specific analysis

## Workflow

### Phase 1: Extract Technical Patterns

Read the input document and extract technical signals:

| Signal | Skill Category |
|--------|---------------|
| "API", "endpoint", "REST" | designer (Spec), implementer |
| "database", "entity", "schema" | designer (Domain Model), fde-analyst |
| "UI", "component", "frontend" | ui-review, a11y_scan |
| "deploy", "CI/CD", "infrastructure" | infra_scan |
| "security", "auth", "JWT" | audit_scan (security), specialist (security) |
| "performance", "latency", "cache" | perf_scan, specialist (perf) |
| "i18n", "locale", "translation" | i18n_validate |
| "migration", "upgrade", "compat" | compat_check |
| "test", "coverage", "QA" | self-checker, coverage_map |

### Phase 2: Match Against Skill Catalog

Compare extracted patterns against the current skill inventory:

| Status | Meaning |
|--------|---------|
| **COVERED** | Skill exists and fully matches the need |
| **PARTIAL** | Skill exists but doesn't cover all aspects |
| **GAP** | No skill covers this need |

### Phase 3: Match Against Tool Catalog

Check which of the 26 MCP tools are relevant:

```
quorum tool code_map        → always relevant
quorum tool dependency_graph → always relevant
quorum tool blast_radius     → always relevant
quorum tool audit_scan       → always relevant
quorum tool perf_scan        → if performance signals
quorum tool a11y_scan        → if UI/frontend signals
quorum tool compat_check     → if migration signals
quorum tool i18n_validate    → if i18n signals
quorum tool infra_scan       → if infrastructure signals
quorum tool coverage_map     → always relevant
```

### Phase 4: Output

```markdown
# Skill Gap Analysis: {track}

## Required Roles
| Role | Status | Reason |
|------|--------|--------|
| designer | COVERED | API endpoints (Spec) + database entities (Domain Model) |
| fde-analyst | COVERED | Payment processing = high failure risk |
| self-checker | COVERED | Standard quality checks |
| specialist (security) | COVERED | Auth/JWT patterns detected |
| ui-review | GAP | Mobile-responsive UI but no browser automation available |

## Required Tools
| Tool | Status | Signal |
|------|--------|--------|
| perf_scan | COVERED | "latency < 100ms" in NFR |
| a11y_scan | PARTIAL | UI present but no a11y requirements in PRD |
| license_scan | NOT NEEDED | No third-party dependencies mentioned |

## Recommended Actions
1. Add a11y requirements to PRD (PARTIAL → COVERED)
2. Consider browser testing setup for ui-review (GAP)

## Domain Detection
Detected domains: security, persistence, performance
Missing domains: none
```

## Rules

- Read-only — does not modify PRD, CPS, or skill files
- Catalog comparison uses current `platform/skills/*/SKILL.md` descriptions
- Tool comparison uses `agents/knowledge/tool-inventory.md`
- GAP status is informational — does not block any workflow

## Anti-Patterns

- Do NOT create skills to fill gaps — only report them
- Do NOT modify PRD to add missing requirements — only suggest
- Do NOT assume a skill exists without checking the catalog
- Do NOT flag everything as GAP — be specific about what's missing
