# Directives & Configuration

## YAML Frontmatter (Recommended)

```yaml
---
title: "Diagram Title"
config:
  theme: dark
  fontFamily: monospace
  flowchart:
    curve: linear
---
flowchart LR
  A --> B
```

## Init Directive (Legacy, deprecated v10.5.0+)

```
%%{init: { "theme": "forest" } }%%
%%{init: { "sequence": { "mirrorActors": false } } }%%
%%{init: { "flowchart": { "curve": "linear" } } }%%
```

Both `init` and `initialize` accepted.

## Top-Level Options

| Option | Values | Default |
|--------|--------|---------|
| `theme` | default, neutral, dark, forest, base | default |
| `fontFamily` | CSS font string | "trebuchet ms" |
| `logLevel` | 1-5 (debug→fatal) | 3 |
| `securityLevel` | strict, loose, antiscript, sandbox | strict |

## Diagram-Specific Config

```yaml
---
config:
  flowchart:
    curve: stepBefore           # basis, linear, step, etc.
    defaultRenderer: elk        # dagre (default) or elk
    diagramPadding: 8
    useMaxWidth: true
  sequence:
    mirrorActors: false
    wrap: true
    showSequenceNumbers: true
    messageAlign: center
  gantt:
    displayMode: compact
    topAxis: true
---
```

## Multiple Directives

Later values override earlier ones. All merged and sent to `mermaid.initialize()`.
