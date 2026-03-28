# quorum Template & Skill Selection Guide

> Quick reference for choosing the right template, skill, or tool for your task.

---

## What are you doing?

```
What are you doing?
│
├─► Planning a new feature?
│   └─► /quorum:planner
│       Generates: PRD, Design (Spec/Blueprint/Domain Model/Architecture), WB
│       References: skills/planner/references/ (13 format specs)
│
├─► Running parliament deliberation?
│   └─► quorum parliament "<topic>"
│       Generates: CPS (Context-Problem-Solution)
│       Feeds into: planner (Phase 0 CPS Intake)
│
├─► Implementing code?
│   └─► /quorum:orchestrator
│       Uses: agents/knowledge/implementer-protocol.md
│       Wave execution with audit gates
│
├─► Submitting evidence for review?
│   └─► audit_submit MCP tool
│       Format: core/templates/references/{locale}/evidence-format.md
│
├─► Verifying implementation?
│   └─► /quorum:verify
│       Checks: CQ/T/CC/CL/S/I/FV/CV (8 done-criteria)
│
├─► Running analysis?
│   └─► /quorum:tools
│       Output template: core/templates/artifacts/{locale}/analysis.md
│
├─► Writing project conventions?
│   └─► Template: core/templates/artifacts/{locale}/convention.md
│       Enforced by: quorum tool blueprint_lint
│
├─► Writing completion report?
│   └─► Template: core/templates/artifacts/{locale}/report.md
│       Skill: /quorum:retrospect
│
├─► Syncing documentation?
│   └─► /quorum:doc-sync
│       3 layers: L1 public docs, L2 RTM, L3 design docs
│
└─► Checking current status?
    └─► /quorum:status
        Shows: audit verdicts, locks, agent assignments
```

---

## Template Categories

### Prompt Templates (runtime-injected)

Used internally by the audit pipeline. Variables (`{{VAR}}`) are substituted at runtime.

| Template | Used By | Purpose |
|----------|---------|---------|
| `audit-prompt.md` | `core/audit/index.mjs` | Auditor verification protocol |
| `fix-prompt.md` | `core/respond.mjs` | Post-rejection correction prompt |
| `retro-prompt.md` | retrospective skill | Retrospective facilitation |

### Reference Documents (read by auditor/implementer)

Shared contracts between implementer and auditor. Located in `references/{locale}/`.

| Reference | Audience | Purpose |
|-----------|----------|---------|
| `done-criteria.md` | Both | Definition of Done (8 categories) |
| `evidence-format.md` | Implementer | Evidence package format |
| `output-format.md` | Auditor | Verdict output structure |
| `rejection-codes.md` | Auditor | Rejection code definitions |
| `fix-rules.md` | Implementer | Correction round rules |
| `principles.md` | Both | SOLID + OWASP TOP 10 |
| `test-checklist.md` | Auditor | Test sufficiency checklist |
| `traceability-matrix.md` | Scout | RTM format specification |
| `fvm-roles.md` | Both | FVM role hierarchy |
| `retro-questions.md` | Both | Retrospective phases |
| `memory-cleanup.md` | Both | Memory file audit criteria |

### Artifact Templates (project deliverables)

Fill-in templates for project documents. Located in `artifacts/{locale}/`.

| Template | When to Use | Related Skill |
|----------|-------------|---------------|
| `convention.md` | Project setup, early planning | `blueprint_lint` tool |
| `analysis.md` | Post-implementation verification | `/quorum:verify` |
| `report.md` | Track/wave completion, retrospective | `/quorum:retrospect` |

### Planner References (format specifications)

Detailed format specs for planning documents. Located in `platform/skills/planner/references/`.

| Reference | Document Type |
|-----------|--------------|
| `prd.md` | Product Requirements Document |
| `design-phase.md` | 4 Design Artifacts (Spec, Blueprint, Domain Model, Architecture) |
| `work-breakdown.md` | Work Breakdown structure |
| `data-model.md` | Entity/state definitions |
| `api-contract.md` | API specification |
| `test-strategy.md` | Testing approach |
| `ui-spec.md` | UI component specs |
| `adr.md` | Architecture Decision Records |

---

## Customization

Templates can be overridden per-project:

1. Create `.claude/quorum/templates/` in your project
2. Copy the file you want to customize from `core/templates/`
3. Edit to match your project's needs

The `resolvePluginPath()` fallback chain checks project dir first, then plugin defaults.

---

## Locale Support

- English: `references/en/`, `artifacts/en/`
- Korean: `references/ko/`, `artifacts/ko-KR/`
- Set via `plugin.locale` in `.claude/quorum/config.json`
