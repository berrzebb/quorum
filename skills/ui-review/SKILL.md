---
name: quorum:ui-review
description: "Verify frontend implementation against UI spec using a real browser. Checks rendering, visual states, interactions, a11y, and runtime errors."
---

# UI Review

Verify frontend implementation against UI specifications using a real browser. Adapter-independent — browser automation method varies by environment.

## Core Protocol

Read and follow: `agents/knowledge/ui-review-protocol.md`

## Browser Priority

| Priority | Method | When Available |
|:--------:|--------|----------------|
| 1 | Chrome MCP | Claude Code with chrome plugin |
| 2 | AgentBrowser | AgentBrowser MCP configured |
| 3 | Playwright | `@playwright/test` installed |
| 4 | Puppeteer | `puppeteer` installed |

If no browser tool is available, report `infra_failure`.

## Verification Checklist (UI-1 through UI-8)

| # | Check | What to Verify |
|---|-------|---------------|
| UI-1 | Renders without errors | No console errors/warnings on page load |
| UI-2 | 4-state coverage | Loading, Error, Empty, Success all render |
| UI-3 | Responsive layout | Desktop (1280px), Tablet (768px), Mobile (375px) |
| UI-4 | Dark mode | Toggle and verify contrast/colors (if applicable) |
| UI-5 | Keyboard navigation | Tab order, Enter/Space activation |
| UI-6 | Accessibility | aria-labels, alt text, screen reader compatibility |
| UI-7 | Interactions | Click, form submit, pagination, state transitions |
| UI-8 | Data formats | Dates, currency, percentages match spec |

## Available Tools

| Tool | Use |
|------|-----|
| `a11y_scan` | Static accessibility scan (JSX/TSX) |
| `doc_coverage` | Component documentation completeness |
| `code_map` | Component hierarchy verification |

Run via: `quorum tool <name> --json`

## Completion Gate

Every component in the UI spec must be checked. Do NOT exit without producing the full verification report with all 8 checklist statuses (pass/fail/skip).
