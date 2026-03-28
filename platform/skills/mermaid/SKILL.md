---
name: quorum:mermaid
description: "Generate mermaid diagrams from natural language descriptions or codebase analysis. Supports 13 diagram types (flowchart, sequence, class, state, ER, gantt, pie, radar, gitgraph, mindmap, timeline, architecture, block). Read the matching reference before generating. Use this skill whenever the user asks to visualize, diagram, chart, or draw anything — architecture, flows, schemas, timelines, relationships, hierarchies, or project schedules. Triggers on 'draw', 'diagram', 'mermaid', 'flowchart', 'sequence diagram', 'visualize', 'chart', '다이어그램', '시퀀스', '시각화', '구조도'."
argument-hint: "<diagram type or description>"
---

# Mermaid Diagram Generator

Generate publication-quality mermaid diagrams. Each diagram type has a dedicated reference with full syntax and examples.

## Workflow

1. **Determine diagram type** from user request (see Selection Guide below) or auto-detect from context
2. **Read the reference** at `platform/skills/mermaid/references/{type}.md` — always read before generating
3. **Analyze codebase** if the diagram should reflect actual code (see Codebase Analysis below)
4. **Generate mermaid code** following the reference syntax exactly
5. **Self-verify** the output (see Verification Checklist below)
6. **Output** as a fenced code block with `mermaid` language tag

## Diagram Type Selection Guide

| User Intent | Diagram Type | Reference |
|-------------|-------------|-----------|
| Process flow, decision tree, workflow | `flowchart` | flowchart.md |
| API call sequence, message passing | `sequence` | sequence.md |
| Class hierarchy, interfaces, relationships | `class` | class.md |
| State machine, lifecycle, transitions | `state` | state.md |
| Database schema, table relationships | `er` | er.md |
| Project timeline, task scheduling | `gantt` | gantt.md |
| Distribution, proportions | `pie` | pie.md |
| Multi-axis comparison, scores | `radar` | radar.md |
| Branch/merge history, release flow | `gitgraph` | gitgraph.md |
| Concept hierarchy, brainstorming | `mindmap` | mindmap.md |
| Chronological events, milestones | `timeline` | timeline.md |
| System components, infrastructure | `architecture` | architecture.md |
| Layout-based block arrangement | `block` | block.md |

### Ambiguous Request Heuristics

When the user's intent maps to multiple types, prefer:
- "flow" or "process" → `flowchart` (most versatile)
- "API" or "request/response" → `sequence`
- "architecture" or "system" → `architecture` (if infra-focused) or `flowchart` (if logic-focused)
- "schema" or "tables" → `er`
- "timeline" + tasks/dependencies → `gantt`; "timeline" + events → `timeline`
- When uncertain, ask the user or default to `flowchart`

### Cross-Cutting References

| Topic | Reference |
|-------|-----------|
| YAML frontmatter, init directive, diagram config | directives.md |
| Themes (default/dark/forest/neutral/base), themeVariables | theming.md |
| KaTeX math expressions in labels | math.md |

## Codebase Analysis

When the user asks to diagram actual code structure:

1. Use `code_map` tool to get module/function overview
2. Use `dependency_graph` tool to get import relationships
3. Map the results to diagram elements:
   - Modules/files → nodes or subgraphs
   - Imports/dependencies → edges
   - Class hierarchies → class diagram relationships
   - State transitions → state diagram
4. Use **actual names** from code (file paths, class names, function names) — never invent names

## Output Rules

- Always wrap in ` ```mermaid ` fenced code block
- Use descriptive node IDs (`authService`, `userDB`) not single letters (`A`, `B`)
- Korean labels — wrap in double quotes: `A["한국어 라벨"]`
- Max ~20 nodes per diagram — split into multiple diagrams if larger
- For codebase diagrams: use actual file/class/function names from the code
- Include a `%%` comment at the top describing what the diagram shows

## Common Pitfalls

These are the most frequent errors when generating mermaid. Avoid them:

| Pitfall | Wrong | Right |
|---------|-------|-------|
| Special chars in labels | `A[User's Data]` | `A["User's Data"]` |
| Parentheses in labels | `A(fn(x))` | `A["fn(x)"]` |
| Unclosed subgraph | `subgraph X` ... (no end) | `subgraph X` ... `end` |
| Missing participant declaration | (use name directly) | `participant A as "Service"` |
| ER relationship typo | `USER \|--o{ ORDER` | `USER \|\|--o{ ORDER` |
| Gantt missing dateFormat | (omit line) | `dateFormat YYYY-MM-DD` |
| Pie negative values | `"Loss" : -5` | (values must be > 0) |
| Radar wrong keyword | `radar` | `radar-beta` |
| Architecture wrong keyword | `architecture` | `architecture-beta` |
| Node ID with spaces | `my node[Label]` | `myNode[Label]` or `my_node[Label]` |
| Flowchart edge to subgraph | edge inside subgraph def | define edge outside subgraph |
| Mindmap wrong indent | mixed tabs and spaces | consistent spaces only |

## Verification Checklist

Before outputting, mentally verify:

1. **Syntax keyword** correct? (`flowchart`, `sequenceDiagram`, `classDiagram`, `stateDiagram-v2`, `erDiagram`, `gantt`, `pie`, `radar-beta`, `gitGraph`, `mindmap`, `timeline`, `architecture-beta`, `block-beta`)
2. **All blocks closed?** Every `subgraph`/`loop`/`alt`/`opt`/`par`/`critical`/`rect`/`block`/`state {`/`box` has a matching `end`
3. **Node IDs unique?** No duplicate IDs with different labels
4. **Special characters quoted?** Labels with `()`, `'`, `"`, `{}`, `[]` wrapped in `"..."`
5. **Edge count reasonable?** Diagrams with >30 edges become unreadable — simplify or split
6. **Direction set?** Large diagrams benefit from explicit `direction LR` or `TD`

## Complexity Management

For large systems:

- **Split by layer**: one diagram per architectural layer (frontend, backend, data)
- **Split by concern**: separate diagrams for data flow, deployment, and class structure
- **Overview + Detail**: one high-level diagram with subgraphs, then detailed diagrams per subgraph
- **Consistent IDs**: when splitting, use the same node IDs across diagrams so readers can cross-reference
