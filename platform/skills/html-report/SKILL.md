---
name: quorum:html-report
description: "Generate interactive single-file HTML reports for code analysis, project status, and technical documentation. Features Mermaid diagrams, syntax-highlighted code, dark/light mode, collapsible sections, table of contents sidebar, and print-friendly layout. Use whenever the user wants an HTML report, a shareable web-based report, or browser-viewable analysis results. Also triggers when /report output needs HTML export. Triggers on 'html report', 'HTML', 'web report', 'browser report', 'interactive report', 'HTML 보고서', 'HTML로 내보내기', '웹 보고서', '인터랙티브 리포트'."
argument-hint: "<operation: create|convert|template>"
---

# HTML Report Generator

Generate self-contained, interactive HTML reports from code analysis results or markdown content.

## Quick Reference

| Task | Approach | Detail |
|------|----------|--------|
| Markdown → HTML | `python scripts/md_to_html.py report.md -o report.html` | Full conversion |
| With custom theme | Add `--theme dark` or `--primary-color "#1E2761"` | Color customization |
| Template-based | Write content directly into `assets/template.html` | Full control |
| Open in browser | `start report.html` (Windows) / `open report.html` (Mac) | Instant preview |

## Workflow

1. **Gather content** — run analysis tools, collect data
2. **Write markdown** — standard `.md` with mermaid blocks, tables, code
3. **Convert** via `md_to_html.py` script
4. **Verify** — open in browser, check rendering
5. **Deliver** — single `.html` file, no server needed

## Dependencies

None required for basic usage. The HTML template loads these from CDN:
- **Mermaid.js** — diagram rendering
- **Prism.js** — code syntax highlighting

For offline use, the script can inline these libraries (see `--offline` flag).

## Markdown Input

Write standard markdown. The script converts to a rich HTML report:

- Headings → auto-generated TOC sidebar
- Code blocks → syntax-highlighted with Prism.js
- ```` ```mermaid ```` → rendered Mermaid diagrams
- Tables → styled, sortable tables
- Lists, blockquotes, horizontal rules → styled HTML
- Images → responsive, centered

```bash
python skills/html-report/scripts/md_to_html.py report.md \
  --title "Architecture Analysis" \
  --author "Claude" \
  --date "2026-03-27" \
  -o report.html
```

## Features

### Single-File Output
Everything is embedded in one `.html` file — CSS, JavaScript, content. Share via email, Slack, or file system. No server needed.

### Dark / Light Mode
Toggle button in the sidebar. Respects system preference by default. Both modes are print-friendly.

### Table of Contents
Auto-generated from headings. Sidebar navigation with:
- Click to scroll
- Active section highlighting
- Collapsible on mobile

### Mermaid Diagrams
```` ```mermaid ```` blocks render as interactive diagrams. Supports all 13 diagram types (flowchart, sequence, class, state, ER, gantt, pie, radar, gitgraph, mindmap, timeline, architecture, block).

For diagram syntax, reference `platform/skills/mermaid/references/`.

### Code Highlighting
Fenced code blocks get automatic syntax highlighting via Prism.js. Supported languages include: javascript, typescript, python, go, rust, java, bash, json, yaml, sql, css, html, and more.

### Collapsible Sections
Long code blocks and detail sections can be collapsed. Use HTML `<details>` in markdown:

```markdown
<details>
<summary>Click to expand full output</summary>

... long content ...

</details>
```

### Print-Friendly
`Ctrl+P` produces a clean printout: sidebar hidden, full-width content, proper page breaks.

## Theme Customization

### Via CLI Flags

```bash
python scripts/md_to_html.py report.md \
  --primary-color "#1E2761" \
  --accent-color "#065A82" \
  --font-body "Inter, sans-serif" \
  --font-code "JetBrains Mono, monospace" \
  -o report.html
```

### Via CSS Variables

Edit the `:root` block in the generated HTML or template:

```css
:root {
  --color-primary: #1E2761;
  --color-accent: #065A82;
  --color-bg: #ffffff;
  --color-surface: #f8f9fa;
  --color-text: #1a1a2e;
  --color-text-muted: #6c757d;
  --color-border: #dee2e6;
  --color-code-bg: #f5f5f5;
  --font-body: 'Inter', -apple-system, sans-serif;
  --font-code: 'JetBrains Mono', 'Consolas', monospace;
  --font-heading: 'Inter', -apple-system, sans-serif;
}
```

Read `references/customization.md` for full theme customization guide.

## Template System

For complete control, copy `assets/template.html` and modify:

1. **Branding** — logo, colors, fonts in CSS variables
2. **Layout** — sidebar position, header content
3. **Sections** — add/remove fixed sections
4. **Footer** — custom footer content

Use `--template custom.html` to apply:

```bash
python scripts/md_to_html.py report.md --template custom.html -o report.html
```

## Integration with /report

After generating a markdown report via `/report`:

```bash
python skills/html-report/scripts/md_to_html.py \
  .claude/reports/project-report.md \
  -o project-report.html
```

## Bundled Scripts & Assets

| Path | Purpose |
|------|---------|
| `scripts/md_to_html.py` | Main converter (MD → HTML) |
| `assets/template.html` | Base HTML template |

## References

| Reference | When to read |
|-----------|-------------|
| `references/customization.md` | Theme customization, layout options, advanced features |
