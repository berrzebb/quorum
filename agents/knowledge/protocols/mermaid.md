# Mermaid Protocol

Generate publication-quality mermaid diagrams. Each diagram type has a dedicated reference.

## Diagram Type Selection

| User Intent | Type | Reference |
|-------------|------|-----------|
| Process flow, decision tree | `flowchart` | `references/mermaid/flowchart.md` |
| API call sequence | `sequence` | `references/mermaid/sequence.md` |
| Class hierarchy | `class` | `references/mermaid/class.md` |
| State machine, lifecycle | `state` | `references/mermaid/state.md` |
| Database schema | `er` | `references/mermaid/er.md` |
| Project timeline | `gantt` | `references/mermaid/gantt.md` |
| Distribution | `pie` | `references/mermaid/pie.md` |
| Multi-axis comparison | `radar` | `references/mermaid/radar.md` |
| Branch/merge history | `gitgraph` | `references/mermaid/gitgraph.md` |
| Concept hierarchy | `mindmap` | `references/mermaid/mindmap.md` |
| Chronological events | `timeline` | `references/mermaid/timeline.md` |
| System components | `architecture` | `references/mermaid/architecture.md` |
| Layout blocks | `block` | `references/mermaid/block.md` |

Cross-cutting: `references/mermaid/directives.md` (config), `references/mermaid/theming.md`, `references/mermaid/math.md`.

## Codebase Analysis

When diagramming actual code: use `code_map` for module overview, `dependency_graph` for imports. Use actual names from code — never invent names.

## Output Rules

- Wrap in ` ```mermaid ` fenced code block
- Descriptive node IDs (`authService`, not `A`)
- Korean labels in double quotes: `A["한국어 라벨"]`
- Max ~20 nodes per diagram — split if larger

## Common Pitfalls

| Pitfall | Right |
|---------|-------|
| Special chars in labels | Wrap in `"..."` |
| Unclosed subgraph | Always close with `end` |
| ER relationship typo | `\|\|--o{` (double pipe) |
| Radar wrong keyword | `radar-beta` |
| Architecture wrong keyword | `architecture-beta` |
| Node ID with spaces | Use camelCase or snake_case |

## Verification Checklist

1. Syntax keyword correct?
2. All blocks closed?
3. Node IDs unique?
4. Special characters quoted?
5. Edge count reasonable? (>30 = split)
6. Direction set for large diagrams?
