# Radar Chart (Beta)

## Basic

```mermaid
---
title: "Code Quality Scores"
---
radar-beta
  axis cq["Code Quality"], t["Tests"], cc["Claim-Code"]
  axis cl["Cross-Layer"], s["Security"], i["i18n"]
  curve a["Project A"]{85, 90, 80, 70, 75, 90}
  curve b["Project B"]{70, 75, 85, 80, 90, 85}

  max 100
  min 0
```

## Syntax

```
radar-beta
  axis <id>["Label"], <id>["Label"], ...    %% Axes (comma-separated, one or multiple lines)
  curve <id>["Label"]{v1, v2, ...}          %% Data series (values match axis order)
  max <number>                               %% Scale maximum
  min <number>                               %% Scale minimum
```

## Rules

- `radar-beta` keyword required (feature is in beta)
- Title via YAML frontmatter: `---\ntitle: "..."\n---`
- Axes rendered clockwise from top
- Each curve must have exactly as many values as total axes
- Multiple `axis` lines allowed — all axes are concatenated
