# Timeline

## Basic

```mermaid
timeline
  title quorum Version History
  2024-Q1 : v0.1 Initial audit gate
          : Hook-based evidence detection
  2024-Q2 : v0.2 Multi-provider consensus
          : SQLite EventStore
  2024-Q3 : v0.3 Parliament protocol
  2024-Q4 : v0.4 Full orchestration
  2025-Q1 : v0.4.5 OpenAI-compatible
```

## Multiple Events per Period

```
time period : event 1 : event 2 : event 3
```

or

```
time period : event 1
            : event 2
            : event 3
```

## Sections

```mermaid
timeline
  title Project

  section Design
    Jan : Requirements
    Feb : Architecture

  section Development
    Mar : Backend
        : Database
    Apr : Frontend

  section Launch
    Jun : Release
```

Each section gets consistent color treatment.

## Text

- Long text wraps automatically
- Force line breaks with `<br>`
- Time labels are free-form (dates, quarters, sprints, etc.)

## Styling

- Default: individual time periods have distinct colors
- `disableMulticolor`: all periods share one scheme
- Theme variables: `cScale0`-`cScale11` (background), `cScaleLabel0`-`cScaleLabel11` (text)
- Themes: `base`, `forest`, `dark`, `default`, `neutral`
