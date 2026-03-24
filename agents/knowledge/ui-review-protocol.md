# UI Review Protocol

Verify frontend implementation against UI specifications using a real browser. This protocol is adapter-independent — the browser automation method varies by adapter.

## Browser Automation

Choose the best available method in priority order:

| Priority | Method | When Available |
|:--------:|--------|----------------|
| 1 | **Chrome MCP** (`tabs_create`, `navigate`, `read_page`, `javascript_tool`) | Claude Code with claude-in-chrome plugin |
| 2 | **AgentBrowser** (headless browser API) | When AgentBrowser MCP is configured |
| 3 | **Playwright** (`npx playwright test` or scripted `page.*` API) | When `@playwright/test` is installed |
| 4 | **Puppeteer** (`npx puppeteer` or scripted) | When `puppeteer` is installed |

Chrome MCP is preferred because it uses the user's actual browser — reflecting real rendering, extensions, and auth state. Playwright/Puppeteer run headless and may miss environment-specific issues.

If no browser tool is available → report `infra_failure`.

## Setup

1. **Check browser tools** — detect which method is available (priority order above)
2. **Verify dev server** is running: `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000` (or configured port). Do NOT start it yourself.
3. **Read UI spec** from the planning directory — extract component hierarchy, states, interactions, a11y requirements

If dev server is not running → report `infra_failure`, do NOT attempt to start services.

## Verification Checklist

For **each component** in the UI spec, verify all 8 checks:

| # | Check | What to Verify |
|---|-------|---------------|
| UI-1 | Renders without errors | No console errors/warnings on page load |
| UI-2 | 4-state coverage | Loading, Error, Empty, Success all render correctly |
| UI-3 | Responsive layout | Desktop (1280px), Tablet (768px), Mobile (375px) |
| UI-4 | Dark mode | If applicable — toggle and verify contrast/colors |
| UI-5 | Keyboard navigation | Tab order logical, Enter/Space activate controls |
| UI-6 | Accessibility | aria-labels present, alt text on images, screen reader compatible |
| UI-7 | Interactions | Click, form submit, pagination, state transitions work |
| UI-8 | Data formats | Dates, currency, percentages match spec |

## Available Tools

| Tool | Use |
|------|-----|
| `a11y_scan` | Static accessibility scan (JSX/TSX files) |
| `doc_coverage` | Component documentation completeness |
| `code_map` | Component hierarchy verification |

Run via: `quorum tool <name> --json`

## Output Format

```json
{
  "verdict": "approved" | "changes_requested" | "infra_failure",
  "reasoning": "overall assessment",
  "components_checked": 5,
  "findings": [
    {
      "component": "ComponentName",
      "check": "UI-3",
      "state": "loading|error|empty|success",
      "issue": "description",
      "severity": "high|medium|low",
      "screenshot": "path (if captured)"
    }
  ],
  "checklist": {
    "UI-1": "pass|fail|skip",
    "UI-2": "pass|fail|skip",
    ...
  }
}
```

## Completion Gate

Do NOT exit without producing the verification report. Every component in the UI spec must be checked.

## Anti-Patterns
- Do NOT start the dev server yourself — report infra_failure if not running
- Do NOT review backend logic — focus on visual/interaction correctness only
- Do NOT skip accessibility checks (UI-5, UI-6)
- Do NOT assume mobile layout works — verify at breakpoints
- Do NOT look for verdict.md or gpt.md — verdicts are in SQLite only
