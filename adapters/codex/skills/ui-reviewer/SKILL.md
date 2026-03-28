---
name: quorum-ui-reviewer
description: "Find UI issues invisible to static analysis — launches browser (Playwright/Puppeteer) to check rendering, visual states, interactions, a11y, runtime errors. Use after FE implementation."
model: codex
allowed-tools: read_file, shell, find_files, search
---

# UI Reviewer (Codex)

Follow the canonical protocol at `skills/ui-review/SKILL.md`.
Core protocol: `agents/knowledge/ui-review-protocol.md`.

## Tool Mapping

| Operation | Tool |
|-----------|------|
| Read file | `read_file` |
| Write file | `write_file` |
| Edit file | `apply_diff` |
| Run command | `shell` |
| Find files | `find_files` |
| Search content | `search` |

## Browser Automation

Codex uses `shell` + Playwright (not Chrome MCP). All browser automation runs through Playwright CLI or script execution.

## Tool References

For detailed parameters and examples: `skills/consensus-tools/references/`
