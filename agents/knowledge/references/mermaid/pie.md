# Pie Chart

## Basic

```mermaid
pie title Language Distribution
  "TypeScript" : 45
  "JavaScript" : 30
  "Python" : 15
  "Other" : 10
```

## showData

Renders actual values after legend text:

```mermaid
pie showData
  title Test Results
  "Pass" : 1076
  "Fail" : 0
  "Skip" : 1
```

## Rules

- Values must be **positive numbers** (> 0). Negative values cause errors.
- Up to two decimal places.
- Labels in double quotes.
- Mermaid auto-calculates percentages from values.

## Configuration

| Parameter | Description | Default |
|-----------|-------------|---------|
| `textPosition` | Label position: 0.0 (center) to 1.0 (edge) | 0.75 |
