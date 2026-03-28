---
name: quorum-ui-reviewer
description: "Find UI issues invisible to static analysis — launches a real browser (via Playwright/Puppeteer) to check rendering, visual states, interactions, a11y, and runtime errors. Use after FE implementation, when UI spec verification is needed, or when the user wants visual regression checks. Triggers on 'check UI', 'visual review', 'does it render correctly'."
model: gemini-2.5-pro
allowed-tools: read_file, shell, glob, grep
---

# UI Reviewer (Gemini)

Follow the canonical protocol at `platform/skills/ui-review/SKILL.md`.
Core protocol: `agents/knowledge/ui-review-protocol.md`.

## Tool Mapping

| Operation | Tool |
|-----------|------|
| Read file | `read_file` |
| Find files | `glob` |
| Search content | `grep` |
| Run command | `shell` |

## Browser Automation

Gemini uses `shell` + Playwright (not Chrome MCP). All browser automation runs through Playwright CLI or script execution.

## Tool References

For detailed parameters and examples: `platform/skills/consensus-tools/references/`
