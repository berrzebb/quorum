# Expected Quality Standards — HTML Report

1. **Valid HTML5 Structure**: The output must be a well-formed HTML5 document with `<!DOCTYPE html>`, `<html>`, `<head>` (including charset and viewport meta tags), and `<body>`. The HTML must pass basic validation (no unclosed tags, no orphaned elements, correct nesting).

2. **Responsive Layout**: The dashboard must be usable on both desktop and mobile viewports. This requires CSS media queries or a responsive framework approach (flexbox/grid). Tables must not overflow on narrow screens (use horizontal scroll or responsive table patterns). Minimum: readable at 375px and 1440px widths.

3. **Data Sourced from Audit Store**: All displayed data must originate from the SQLite event store via `audit_history` MCP tool or direct query. Verdict history must show actual session outcomes. Fitness trends must reflect real fitness score records. Domain coverage must show which domains were activated. No mock or placeholder data.

4. **Interactive Elements**: The dashboard must include at least two interactive features from: sortable table columns (click header to sort), collapsible/expandable sections (show/hide details), filterable data (by date, verdict, domain), or interactive charts (hover tooltips, zoom). Pure static HTML tables without any interactivity are insufficient.

5. **Embedded CSS Styling**: All styling must be included inline or in a `<style>` block within the HTML file. No external CSS file references (the file must be self-contained). The styling must provide: distinct header/nav, card or panel layout for dashboard sections, table striping for readability, and a consistent color scheme.

6. **Three Required Dashboard Sections**: The report must include all three requested sections:
   - **Verdict History**: Table or timeline showing audit session outcomes (date, session ID, verdict, finding count)
   - **Fitness Trends**: Chart or table showing fitness score progression over time (7 components or composite score)
   - **Domain Coverage**: Visualization showing which domains (perf, a11y, security, etc.) were activated and their finding counts

7. **Self-Contained Single File**: The HTML file must open correctly by double-clicking in a browser — no web server required, no external JS/CSS CDN dependencies (or use CDN with fallback). All JavaScript for interactivity must be embedded in `<script>` tags within the file.
