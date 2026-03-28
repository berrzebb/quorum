# Consensus Protocol

> No single perspective can reliably distinguish root cause from symptom.

## Why Multi-Voice?

A single model reviewing code has a fundamental limitation: it cannot challenge its own assumptions. If it misidentifies a symptom as the root cause, nothing in the system corrects that misidentification.

quorum solves this with **3-role deliberative consensus**:

| Role | Question | Purpose |
|------|----------|---------|
| **Advocate** | "What merit does this have?" | Finds genuine value, prevents false negatives |
| **Devil's Advocate** | "Does this fix the actual problem or only a symptom?" | Challenges assumptions, exposes hidden risks |
| **Judge** | "Given both perspectives, what is the verdict?" | Weighs evidence, produces final classification |

The Devil's Advocate question — "root cause vs symptom?" — is the one no single model answers reliably alone. Three voices in deliberation can **triangulate truth**.

## Diverge-Converge Protocol

The protocol operates in three phases:

```
Phase A: Diverge
  All roles speak freely — no constraints, no role labels.
  Maximum surface area of observations.

Phase B: Converge
  Judge synthesizes into 4 MECE registers:
  ├── Status Changes    (what state transitions occurred?)
  ├── Decisions         (what was decided and why?)
  ├── Requirement Changes (what scope changed?)
  └── Risks            (what could go wrong?)

Phase C: Classify
  5-classification analysis:
  ├── Gap      (missing requirement coverage)
  ├── Strength (well-implemented area)
  ├── Out      (out of scope — defer)
  ├── Buy      (use existing solution)
  └── Build    (implement from scratch)
```

## Trigger Tiers

Not all changes need full deliberation. The 13-factor trigger system evaluates each evidence submission and routes to the appropriate tier:

| Tier | Condition | Action |
|------|-----------|--------|
| **T1** (skip) | Low risk, routine change | No audit needed |
| **T2** (solo) | Moderate complexity | Single auditor verdict |
| **T3** (deliberative) | High risk, cross-cutting | Full 3-role consensus |

The 13 factors include: file risk, blast radius, cross-layer changes, security sensitivity, API surface, test coverage gaps, rejection history, stagnation patterns, domain complexity, and interaction multipliers.

## Parliament Extension

For strategic decisions (architecture, design, requirements), the parliament protocol extends consensus to a full legislative model:

- **Standing Committees** (6): Principles, Definitions, Structure, Architecture, Scope, Research Questions
- **Meeting Logs**: Accumulate sessions → 3-path convergence detection → CPS generation
- **Amendments**: Propose → vote (majority) → resolve — legislative change management
- **Confluence**: Post-audit 4-point integrity (Law↔Code, Part↔Whole, Intent↔Result, Law↔Law)
- **Enforcement Gates**: 5 gates that BLOCK work until resolved

## Provider Flexibility

The consensus protocol is provider-agnostic. `config.json` maps roles to providers:

```json
{
  "consensus": {
    "roles": {
      "advocate": "openai",
      "devil": "claude",
      "judge": "codex"
    }
  }
}
```

Different models for different roles maximizes perspective diversity.

## Related

- [Core Mission](core-mission.md) — why structural enforcement
- [Normal Form](normal-form.md) — where consensus converges to
