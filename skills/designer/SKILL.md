---
name: quorum:designer
description: "Generate and validate design documents (Spec, Blueprint, Domain Model, Architecture) with mandatory mermaid diagrams. Use this skill after PRD confirmation when the DRM requires Design Phase artifacts. Triggers on 'generate design', 'design docs', 'create spec', 'create blueprint', '설계 문서', '설계 생성', 'design phase'."
argument-hint: "<track name>"
context: fork
mergeResult: true
permissionMode: acceptEdits
memory: project
skills:
  - mermaid
tools:
  - read
  - write
  - edit
  - glob
  - grep
  - bash
hooks: {}
---

# Designer

Generate 4 design artifacts that define **how** to build what the PRD specifies. Design artifacts are laws — they remove subjective implementation decisions from implementers.

## Pipeline Phase

| Phase | Role | Active |
|-------|------|--------|
| 1. Parliament | — | — |
| 2. Planning | Consumes PRD + DRM | input |
| 3. **Design** | **Generates Spec, Blueprint, Domain Model, Architecture** | **✅ primary** |
| 4. Implementation | Implementer consumes design artifacts | downstream |
| 5. Verification | blueprint_lint validates naming conventions | downstream |
| 6. Audit | — | — |
| 7. Convergence | Gap-detector compares design vs code | downstream |
| 8. Retrospective | — | — |

## When to Use

- Track originates from Parliament CPS (CPS→Design is mandatory)
- New product/feature track with 3+ WB items
- Any track with external API surface or persistence
- DRM has `req` in the Design Phase row

## Input Requirements

Before starting, verify these exist:
1. **PRD** with confirmed FR/NFR requirements
2. **DRM** with Design Phase row marked `req`
3. **Research results** from `quorum tool code_map` and `quorum tool dependency_graph`

If any are missing, stop and inform the user.

## 4 Artifacts

Each artifact lives at `{planning_dir}/{track}/design/` and must include mermaid diagrams.

| Artifact | File | Required Diagram | Purpose |
|----------|------|-----------------|---------|
| Spec | `spec.md` | `sequenceDiagram` per API flow | What each FR does technically |
| Blueprint | `blueprint.md` | `flowchart` or `classDiagram` | Module structure + naming law |
| Domain Model | `domain-model.md` | `erDiagram` + `stateDiagram-v2` | Entities + state machines |
| Architecture | `architecture.md` | `architecture-beta` or `flowchart` | System topology + data flow |

Read `skills/designer/references/design-phase.md` for templates and examples of each artifact.

## Workflow

### Phase 1: Scope Assessment

Determine which artifacts are needed based on the DRM:

| Condition | Required Artifacts |
|-----------|-------------------|
| Track has API surface | Spec (always) |
| Track has 3+ modules | Blueprint (always) |
| Track involves persistence | Domain Model |
| Track has infrastructure decisions | Architecture |
| Track includes UI work | Architecture + wireframes |

### Phase 2: Generate Artifacts

For each required artifact:
1. Read the corresponding reference guide
2. Map PRD requirements to artifact sections
3. Generate mermaid diagrams appropriate to the artifact type
4. Write the artifact to `{planning_dir}/{track}/design/`

Artifact generation order matters:
1. **Spec first** — defines inputs/outputs/validation per FR
2. **Blueprint second** — defines module boundaries referencing Spec's interfaces
3. **Domain Model third** — defines entities that modules operate on
4. **Architecture last** — shows how modules + entities compose into a system

### Phase 3: Naming Convention Table

The Blueprint **must** include a Naming Conventions table. This is critical — it removes subjective naming decisions from implementers and is enforced by `quorum tool blueprint_lint`.

| Column | Description |
|--------|------------|
| Concept | What is being named |
| Name | The canonical name to use |
| Rationale | Why this name was chosen |

### Phase 4: Diagram Validation

After generating all artifacts, verify diagram completeness:

1. Scan each artifact for mermaid code blocks
2. Check against the required diagram types table
3. If any required diagram is missing, generate it
4. Validate diagram syntax is well-formed

Run `quorum tool blueprint_lint` on the Blueprint to verify naming conventions are parseable.

### Phase 5: Completeness Report

Output a verification summary:

```
Design Phase: {track}
├── spec.md         ✓ (2 sequence diagrams)
├── blueprint.md    ✓ (1 flowchart, 1 class diagram, naming table: 8 entries)
├── domain-model.md ✓ (1 ER diagram, 2 state machines)
└── architecture.md ✓ (1 architecture diagram, data flow table)
```

Report any gaps. Do not mark complete until all required artifacts exist with valid diagrams.

## Rules

1. **Design before WB** — Work Breakdowns reference Design artifacts, not the reverse
2. **Naming is law** — Blueprint naming conventions are binding for all implementers
3. **Interfaces are contracts** — Changing an interface requires an Amendment (majority vote)
4. **State machines are exhaustive** — Every valid transition must be listed; unlisted = forbidden
5. **Diagrams are contracts** — Not decorative; they define exact call order, cardinality, topology

## Anti-Patterns

- Do NOT repeat PRD content — Design adds technical precision, not restatement
- Do NOT leave naming decisions to implementers — decide in Blueprint
- Do NOT skip Domain Model for data-heavy tracks — prevents schema confusion
- Do NOT generate Architecture without considering NFRs — performance/security constraints drive technology choices
- Do NOT proceed to WB generation with missing diagrams
