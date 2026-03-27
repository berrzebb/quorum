---
name: quorum:report
description: "Generate project completion reports with diagrams, metrics, and deliverable summaries. Use after track completion, at milestones, or when the user asks for a project summary/report. Includes architecture diagrams (mermaid), UI wireframes (SVG), and quality metrics. Triggers on 'report', 'summary', 'project status', '보고서', '요약', '프로젝트 현황'."
argument-hint: "[track name or 'all']"
---

# Project Report Generator

Generate comprehensive project completion reports with visual deliverables.

## Workflow

1. **Gather data** — read audit history, track status, RTM, fitness scores
2. **Analyze** — compute metrics, identify patterns, extract learnings
3. **Generate visuals** — architecture diagrams, timeline, quality radar
4. **Write report** — structured markdown with embedded mermaid diagrams
5. **Export** — optionally generate PDF/PPT via respective skills

## Required Sections

| Section | Content | Visual |
|---------|---------|--------|
| Executive Summary | Goals, scope, outcome | Mermaid timeline |
| Architecture | System structure, layers, data flow | Mermaid architecture/flowchart |
| Quality Metrics | CQ/T/CC/CL/S/I/FV/CV/CD scores | Mermaid radar chart |
| Track Status | WB completion, verdicts, correction rounds | Mermaid gantt |
| Contract Compliance | contract_drift results, type coverage | Table |
| UI/Wireframes | Screen layouts, user flows | SVG wireframes |
| Risk & Residual | Known issues, deferred items | Table |
| Learnings | Auto-learn patterns, stagnation events | Bullet list |

## Visual Deliverables (Mandatory)

Every report MUST include:

1. **Architecture diagram** — use `/quorum:mermaid architecture` or `flowchart`
   - Read `skills/mermaid/references/architecture.md` for syntax
2. **Quality radar** — use `/quorum:mermaid radar`
   - Read `skills/mermaid/references/radar.md` for syntax
3. **Timeline** — use `/quorum:mermaid gantt` or `timeline`

### UI / Wireframes

When the project has UI components:

- **Wireframes are mandatory** — generate SVG wireframes for key screens
- Use inline SVG in markdown for simple layouts
- For complex wireframes, create separate `.svg` files
- Reference actual component names from the codebase

### Diagram Generation

```
# Architecture
Read: skills/mermaid/references/architecture.md
Use: architecture-beta or flowchart (for logic flows)

# Quality Radar
Read: skills/mermaid/references/radar.md
Use: radar-beta with 9 axes (CQ, T, CC, CL, S, I, FV, CV, CD)

# Timeline
Read: skills/mermaid/references/gantt.md
Use: gantt for task-based, timeline for event-based
```

## Data Sources

| Data | Tool / Source |
|------|-------------|
| Audit verdicts | `audit_history --summary` |
| Track progress | `quorum status` |
| RTM coverage | `rtm_parse` |
| Code quality | `audit_scan --pattern all` |
| Contract drift | `contract_drift` |
| Fitness score | SQLite `fitness.*` events |
| Dependencies | `dependency_graph` |
| Test coverage | `coverage_map` |

## Output Format

```markdown
# Project Report: {Track/Project Name}

> Generated: {date} | Tracks: {N} | WBs: {completed}/{total} | Verdict: {status}

## 1. Executive Summary
...

## 2. Architecture
```mermaid
architecture-beta
  ...
```

## 3. Quality Metrics
```mermaid
radar-beta
  ...
```

## 4. Track Status
...

## 5. Contract Compliance
...

## 6. UI / Wireframes
<svg>...</svg>

## 7. Risks & Residual
...

## 8. Learnings
...
```

## Export

After generating the markdown report:
- `/pdf` — export to PDF for stakeholders
- `/ppt` — generate slide deck for review meetings
