# HTML Report Customization Guide

## Theme Customization

### CSS Variables

All visual aspects are controlled via CSS custom properties in `:root`. Edit these in the generated HTML or in a custom template:

```css
:root {
  /* Colors */
  --color-primary: #1E2761;      /* Headings, table headers, accents */
  --color-accent: #065A82;       /* Links, blockquote borders */
  --color-bg: #ffffff;           /* Page background */
  --color-surface: #f8f9fa;      /* Sidebar, card backgrounds */
  --color-text: #1a1a2e;         /* Body text */
  --color-text-muted: #6c757d;   /* Secondary text, captions */
  --color-border: #dee2e6;       /* Borders, dividers */
  --color-code-bg: #f5f5f5;      /* Code block background */

  /* Typography */
  --font-body: 'Inter', -apple-system, sans-serif;
  --font-code: 'JetBrains Mono', 'Consolas', monospace;
  --font-heading: 'Inter', -apple-system, sans-serif;

  /* Layout */
  --sidebar-width: 260px;
  --content-max: 900px;
  --radius: 8px;
}
```

### Dark Mode Variables

Dark mode overrides are in `[data-theme="dark"]`:

```css
[data-theme="dark"] {
  --color-bg: #0f1117;
  --color-surface: #1a1b26;
  --color-text: #c9d1d9;
  --color-text-muted: #8b949e;
  --color-border: #30363d;
  --color-code-bg: #161b22;
}
```

### Color Palettes

| Theme | Primary | Accent | Best For |
|-------|---------|--------|----------|
| Midnight (default) | `#1E2761` | `#065A82` | Professional reports |
| Forest | `#2C5F2D` | `#97BC62` | Sustainability, nature |
| Coral | `#F96167` | `#2F3C7E` | Bold, energetic |
| Terracotta | `#B85042` | `#A7BEAE` | Warm, inviting |
| Ocean | `#065A82` | `#1C7293` | Tech, data |
| Charcoal | `#36454F` | `#212121` | Minimal, elegant |

Apply via CLI:
```bash
python scripts/md_to_html.py report.md --primary-color "#2C5F2D" --accent-color "#97BC62" -o report.html
```

## Layout Customization

### Sidebar

- Width: change `--sidebar-width` (default: 260px)
- To hide sidebar by default: add `display: none` to `.sidebar` in CSS
- TOC depth: the script generates entries for h1, h2, h3

### Content Width

- Change `--content-max` to adjust the main content column width
- Default is 900px which provides comfortable reading line lengths

### Remove Sidebar Entirely

Add to CSS:
```css
.sidebar, .menu-toggle { display: none !important; }
.main-content { margin-left: 0 !important; }
```

## Custom Templates

### Creating a Template

1. Copy `assets/template.html`
2. Modify the CSS, layout, header, footer
3. Keep the placeholders: `{{TITLE}}`, `{{META}}`, `{{BODY}}`, `{{THEME_VARS}}`
4. Use with `--template custom.html`

### Template Placeholders

| Placeholder | Replaced With |
|-------------|--------------|
| `{{TITLE}}` | Report title (HTML-escaped) |
| `{{META}}` | Author and date HTML |
| `{{BODY}}` | Converted markdown content |
| `{{THEME_VARS}}` | CSS variable definitions |

### Adding a Logo

In the template's `<header>` section:
```html
<header class="report-header">
  <img src="data:image/png;base64,..." alt="Logo" style="height:48px;margin-bottom:1rem">
  <h1>{{TITLE}}</h1>
  <div class="report-meta">{{META}}</div>
</header>
```

Use base64-encoded images to keep the report self-contained.

## Print Optimization

The template includes `@media print` rules that:
- Hide sidebar and theme toggle
- Full-width content
- Page breaks after report header
- Prevent page breaks inside code blocks and tables
- Reduce font size to 11pt

For custom print styles, add rules inside the `@media print` block.

## Mermaid Diagram Customization

Mermaid diagrams use the CDN version (v11). To customize:

```html
<script type="module">
  import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs';
  mermaid.initialize({
    startOnLoad: true,
    theme: 'default',        // default, dark, forest, neutral
    themeVariables: {
      primaryColor: '#1E2761',
      primaryTextColor: '#fff',
      lineColor: '#065A82',
    },
  });
</script>
```

## Adding Prism.js Syntax Highlighting

For enhanced code highlighting, add to the template's `<head>`:

```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/prismjs@1/themes/prism-tomorrow.min.css">
<script src="https://cdn.jsdelivr.net/npm/prismjs@1/prism.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/prismjs@1/plugins/autoloader/prism-autoloader.min.js"></script>
```

The markdown converter already adds `class="language-{lang}"` to code blocks, so Prism will pick them up automatically.
