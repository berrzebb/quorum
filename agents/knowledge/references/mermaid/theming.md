# Theming

## Built-in Themes

| Theme | Description |
|-------|-------------|
| `default` | Standard theme |
| `neutral` | Black/white print-friendly |
| `dark` | Dark mode |
| `forest` | Green palette |
| `base` | **Only customizable theme** |

## Apply Theme

```yaml
---
config:
  theme: dark
---
```

or

```
%%{init: { "theme": "forest" } }%%
```

## Customize with themeVariables

Only the `base` theme supports variable overrides. **Values must be hex** (not color names).

```yaml
---
config:
  theme: base
  themeVariables:
    primaryColor: "#ff6600"
    primaryTextColor: "#ffffff"
    lineColor: "#333333"
---
```

### Core Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `primaryColor` | #fff4dd | Node backgrounds |
| `primaryTextColor` | calculated | Text on primary |
| `secondaryColor` | calculated | Secondary fill |
| `tertiaryColor` | calculated | Tertiary fill |
| `lineColor` | calculated | Connector stroke |
| `textColor` | calculated | General text |

### Flowchart Variables

`nodeBorder`, `clusterBkg`, `clusterBorder`, `titleColor`, `nodeTextColor`

### Sequence Variables

`actorBkg`, `actorBorder`, `signalColor`, `loopTextColor`, `activationBkgColor`

### Pie Variables

`pie1`-`pie12` (section colors), `pieTitleTextSize`, `pieSectionTextColor`, `pieStrokeWidth`

### State Variables

`labelColor`, `altBackground`

### Class Variables

`classText`

## Color Calculation

Derived colors auto-adjust from primary settings. Set `primaryColor` and most others adapt automatically.
