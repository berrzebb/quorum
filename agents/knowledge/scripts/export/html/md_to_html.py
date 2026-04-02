#!/usr/bin/env python3
"""
md_to_html.py — Convert Markdown to a self-contained interactive HTML report.

Usage:
  python md_to_html.py report.md -o report.html
  python md_to_html.py report.md --title "Analysis" --theme dark -o report.html
  python md_to_html.py report.md --primary-color "#1E2761" -o report.html
  python md_to_html.py report.md --template custom.html -o report.html

No external dependencies required (uses only Python stdlib).
Mermaid.js and Prism.js loaded from CDN in the output HTML.
"""

import argparse
import html
import json
import re
import sys
from pathlib import Path


# ── Markdown → HTML Converter ────────────────────────────────────────────────

def convert_inline(text):
    """Convert inline markdown to HTML: bold, italic, code, links, images."""
    # Images first: ![alt](src)
    text = re.sub(
        r'!\[([^\]]*)\]\(([^)]+)\)',
        r'<img src="\2" alt="\1" style="max-width:100%;display:block;margin:1em auto">',
        text,
    )
    # Links: [text](url)
    text = re.sub(r'\[([^\]]+)\]\(([^)]+)\)', r'<a href="\2">\1</a>', text)
    # Bold italic: ***text***
    text = re.sub(r'\*\*\*(.+?)\*\*\*', r'<strong><em>\1</em></strong>', text)
    # Bold: **text**
    text = re.sub(r'\*\*(.+?)\*\*', r'<strong>\1</strong>', text)
    # Italic: *text*
    text = re.sub(r'\*(.+?)\*', r'<em>\1</em>', text)
    # Inline code: `text`
    text = re.sub(r'`(.+?)`', r'<code>\1</code>', text)
    return text


def md_to_html_body(md_text):
    """Convert markdown text to HTML body content."""
    lines = md_text.split("\n")
    out = []
    i = 0

    while i < len(lines):
        line = lines[i]

        # Heading
        m = re.match(r'^(#{1,6})\s+(.+)$', line)
        if m:
            level = len(m.group(1))
            text = m.group(2).strip()
            slug = re.sub(r'[^\w\s-]', '', text.lower()).strip()
            slug = re.sub(r'[\s]+', '-', slug)
            out.append(
                f'<h{level} id="{slug}">{convert_inline(text)}</h{level}>'
            )
            i += 1
            continue

        # Fenced code block
        if line.startswith("```"):
            lang = line[3:].strip()
            code_lines = []
            i += 1
            while i < len(lines) and not lines[i].startswith("```"):
                code_lines.append(lines[i])
                i += 1
            if i < len(lines):
                i += 1
            code = "\n".join(code_lines)

            if lang == "mermaid":
                out.append(
                    f'<div class="mermaid-container">'
                    f'<pre class="mermaid">{html.escape(code)}</pre>'
                    f'</div>'
                )
            else:
                lang_class = f' class="language-{lang}"' if lang else ''
                out.append(
                    f'<div class="code-block">'
                    f'{"<span class=&quot;code-lang&quot;>" + lang.upper() + "</span>" if lang else ""}'
                    f'<pre><code{lang_class}>{html.escape(code)}</code></pre>'
                    f'</div>'
                )
            continue

        # HTML pass-through (details, summary, etc.)
        if line.strip().startswith("<details") or line.strip().startswith("<summary"):
            out.append(line)
            i += 1
            continue
        if line.strip() in ("</details>", "</summary>"):
            out.append(line)
            i += 1
            continue

        # Table
        if ("|" in line
                and i + 1 < len(lines)
                and re.match(r'^\|[\s\-:|]+\|', lines[i + 1])):
            headers = [c.strip() for c in line.split("|")[1:-1]]
            # Parse alignment from separator
            sep = lines[i + 1]
            aligns = []
            for cell in sep.split("|")[1:-1]:
                cell = cell.strip()
                if cell.startswith(":") and cell.endswith(":"):
                    aligns.append("center")
                elif cell.endswith(":"):
                    aligns.append("right")
                else:
                    aligns.append("left")
            i += 2
            rows = []
            while i < len(lines) and "|" in lines[i]:
                row = [c.strip() for c in lines[i].split("|")[1:-1]]
                rows.append(row)
                i += 1

            table_html = '<div class="table-wrapper"><table><thead><tr>'
            for ci, h in enumerate(headers):
                align = aligns[ci] if ci < len(aligns) else "left"
                table_html += f'<th style="text-align:{align}">{convert_inline(h)}</th>'
            table_html += '</tr></thead><tbody>'
            for row in rows:
                table_html += '<tr>'
                for ci, cell in enumerate(row):
                    align = aligns[ci] if ci < len(aligns) else "left"
                    table_html += f'<td style="text-align:{align}">{convert_inline(cell)}</td>'
                table_html += '</tr>'
            table_html += '</tbody></table></div>'
            out.append(table_html)
            continue

        # Bullet list
        if re.match(r'^[\s]*[-*+]\s', line):
            out.append('<ul>')
            while i < len(lines) and re.match(r'^[\s]*[-*+]\s', lines[i]):
                item = re.sub(r'^[\s]*[-*+]\s', '', lines[i])
                out.append(f'<li>{convert_inline(item)}</li>')
                i += 1
            out.append('</ul>')
            continue

        # Numbered list
        if re.match(r'^[\s]*\d+[.)]\s', line):
            out.append('<ol>')
            while i < len(lines) and re.match(r'^[\s]*\d+[.)]\s', lines[i]):
                item = re.sub(r'^[\s]*\d+[.)]\s', '', lines[i])
                out.append(f'<li>{convert_inline(item)}</li>')
                i += 1
            out.append('</ol>')
            continue

        # Horizontal rule
        if re.match(r'^[\s]*[-*_]{3,}[\s]*$', line):
            out.append('<hr>')
            i += 1
            continue

        # Blockquote
        if line.startswith(">"):
            quote = []
            while i < len(lines) and lines[i].startswith(">"):
                quote.append(lines[i].lstrip("> "))
                i += 1
            out.append(
                f'<blockquote>{convert_inline(" ".join(quote))}</blockquote>'
            )
            continue

        # Paragraph
        if line.strip():
            para = [line.strip()]
            i += 1
            while (i < len(lines)
                   and lines[i].strip()
                   and not lines[i].startswith("#")
                   and not lines[i].startswith("```")
                   and not lines[i].startswith("|")
                   and not re.match(r'^[\s]*[-*+]\s', lines[i])
                   and not re.match(r'^[\s]*\d+[.)]\s', lines[i])
                   and not lines[i].startswith(">")
                   and not re.match(r'^[\s]*[-*_]{3,}[\s]*$', lines[i])
                   and not lines[i].strip().startswith("<")):
                para.append(lines[i].strip())
                i += 1
            out.append(f'<p>{convert_inline(" ".join(para))}</p>')
            continue

        i += 1

    return "\n".join(out)


# ── HTML Template ────────────────────────────────────────────────────────────

def get_template():
    """Return the base HTML template. Placeholders: {{TITLE}}, {{META}}, {{BODY}}, {{THEME_VARS}}."""
    return r"""<!DOCTYPE html>
<html lang="en" data-theme="light">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{{TITLE}}</title>
<style>
/* ── CSS Reset & Variables ──────────────────────────────────────── */
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

:root {
  {{THEME_VARS}}
  --sidebar-width: 260px;
  --content-max: 900px;
  --radius: 8px;
  --shadow: 0 1px 3px rgba(0,0,0,0.08);
  --transition: 0.2s ease;
}

[data-theme="dark"] {
  --color-bg: #0f1117;
  --color-surface: #1a1b26;
  --color-text: #c9d1d9;
  --color-text-muted: #8b949e;
  --color-border: #30363d;
  --color-code-bg: #161b22;
  --color-table-header: var(--color-primary);
  --color-blockquote-border: var(--color-accent);
}

/* ── Base ────────────────────────────────────────────────────────── */
body {
  font-family: var(--font-body);
  font-size: 16px;
  line-height: 1.7;
  color: var(--color-text);
  background: var(--color-bg);
  transition: background var(--transition), color var(--transition);
}

a { color: var(--color-accent); text-decoration: none; }
a:hover { text-decoration: underline; }

/* ── Layout ──────────────────────────────────────────────────────── */
.layout { display: flex; min-height: 100vh; }

.sidebar {
  position: fixed; top: 0; left: 0;
  width: var(--sidebar-width); height: 100vh;
  background: var(--color-surface);
  border-right: 1px solid var(--color-border);
  overflow-y: auto; padding: 1.5rem 1rem;
  transition: transform var(--transition), background var(--transition);
  z-index: 100;
}

.sidebar-header {
  display: flex; justify-content: space-between; align-items: center;
  margin-bottom: 1rem; padding-bottom: 0.75rem;
  border-bottom: 1px solid var(--color-border);
}

.sidebar-header h2 { font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--color-text-muted); }

#theme-toggle {
  background: none; border: 1px solid var(--color-border);
  border-radius: var(--radius); padding: 4px 8px;
  cursor: pointer; font-size: 0.9rem; color: var(--color-text);
  transition: background var(--transition);
}
#theme-toggle:hover { background: var(--color-border); }

.toc { list-style: none; }
.toc li { margin: 2px 0; }
.toc a {
  display: block; padding: 4px 8px; border-radius: 4px;
  font-size: 0.85rem; color: var(--color-text-muted);
  transition: all var(--transition); text-decoration: none;
}
.toc a:hover, .toc a.active { color: var(--color-primary); background: rgba(30,39,97,0.08); }
.toc .toc-h2 { padding-left: 1.2rem; }
.toc .toc-h3 { padding-left: 2.0rem; font-size: 0.8rem; }

.main-content {
  margin-left: var(--sidebar-width);
  flex: 1; padding: 2rem 3rem;
  max-width: calc(var(--content-max) + var(--sidebar-width) + 6rem);
}

/* ── Report Header ───────────────────────────────────────────────── */
.report-header {
  text-align: center; padding: 3rem 0 2rem;
  border-bottom: 2px solid var(--color-primary);
  margin-bottom: 2rem;
}
.report-header h1 {
  font-family: var(--font-heading);
  font-size: 2.5rem; font-weight: 800;
  color: var(--color-primary); margin-bottom: 0.5rem;
}
.report-meta {
  font-size: 0.9rem; color: var(--color-text-muted);
  display: flex; justify-content: center; gap: 1.5rem;
}

/* ── Typography ──────────────────────────────────────────────────── */
h1, h2, h3, h4, h5, h6 {
  font-family: var(--font-heading);
  color: var(--color-primary); margin: 2rem 0 0.75rem;
  scroll-margin-top: 1rem;
}
h1 { font-size: 2rem; border-bottom: 2px solid var(--color-border); padding-bottom: 0.5rem; }
h2 { font-size: 1.5rem; }
h3 { font-size: 1.25rem; }
h4 { font-size: 1.1rem; }

p { margin: 0.75rem 0; }

/* ── Code ────────────────────────────────────────────────────────── */
code {
  font-family: var(--font-code);
  background: var(--color-code-bg);
  padding: 2px 6px; border-radius: 4px;
  font-size: 0.88em;
}

.code-block {
  position: relative; margin: 1rem 0;
  background: var(--color-code-bg);
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  overflow: hidden;
}
.code-block .code-lang {
  position: absolute; top: 0; right: 0;
  padding: 2px 10px; font-size: 0.7rem;
  color: var(--color-text-muted);
  background: var(--color-border); border-bottom-left-radius: var(--radius);
}
.code-block pre {
  padding: 1.25rem 1rem; margin: 0;
  overflow-x: auto; font-size: 0.88rem; line-height: 1.5;
}
.code-block pre code {
  background: none; padding: 0; border-radius: 0;
}

/* ── Mermaid ─────────────────────────────────────────────────────── */
.mermaid-container {
  margin: 1.5rem 0; text-align: center;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  padding: 1.5rem;
}

/* ── Tables ──────────────────────────────────────────────────────── */
.table-wrapper {
  overflow-x: auto; margin: 1rem 0;
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
}
table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
thead { background: var(--color-primary); color: #fff; }
th { padding: 10px 14px; text-align: left; font-weight: 600; }
td { padding: 8px 14px; border-top: 1px solid var(--color-border); }
tbody tr:nth-child(even) { background: var(--color-surface); }
tbody tr:hover { background: rgba(6,90,130,0.06); }

/* ── Lists ───────────────────────────────────────────────────────── */
ul, ol { margin: 0.75rem 0; padding-left: 1.5rem; }
li { margin: 0.3rem 0; }

/* ── Blockquote ──────────────────────────────────────────────────── */
blockquote {
  margin: 1rem 0; padding: 0.75rem 1.25rem;
  border-left: 4px solid var(--color-accent);
  background: var(--color-surface);
  border-radius: 0 var(--radius) var(--radius) 0;
  color: var(--color-text-muted); font-style: italic;
}

/* ── HR ──────────────────────────────────────────────────────────── */
hr { border: none; border-top: 1px solid var(--color-border); margin: 2rem 0; }

/* ── Details ─────────────────────────────────────────────────────── */
details {
  margin: 1rem 0; padding: 0.75rem 1rem;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
}
summary { cursor: pointer; font-weight: 600; color: var(--color-primary); }

/* ── Images ──────────────────────────────────────────────────────── */
img { max-width: 100%; height: auto; border-radius: var(--radius); }

/* ── Mobile ──────────────────────────────────────────────────────── */
.menu-toggle {
  display: none; position: fixed; top: 1rem; left: 1rem;
  z-index: 200; background: var(--color-surface);
  border: 1px solid var(--color-border); border-radius: var(--radius);
  padding: 8px 12px; cursor: pointer; font-size: 1.2rem;
  color: var(--color-text);
}

@media (max-width: 768px) {
  .menu-toggle { display: block; }
  .sidebar { transform: translateX(-100%); }
  .sidebar.open { transform: translateX(0); box-shadow: 4px 0 20px rgba(0,0,0,0.15); }
  .main-content { margin-left: 0; padding: 1rem 1.5rem; padding-top: 3.5rem; }
}

/* ── Print ───────────────────────────────────────────────────────── */
@media print {
  .sidebar, .menu-toggle, #theme-toggle { display: none !important; }
  .main-content { margin-left: 0 !important; padding: 0 !important; max-width: 100% !important; }
  .report-header { page-break-after: always; }
  h1, h2, h3 { page-break-after: avoid; }
  pre, table, .mermaid-container { page-break-inside: avoid; }
  body { font-size: 11pt; }
}
</style>
</head>
<body>
<button class="menu-toggle" onclick="document.querySelector('.sidebar').classList.toggle('open')">☰</button>

<div class="layout">
  <nav class="sidebar">
    <div class="sidebar-header">
      <h2>Contents</h2>
      <button id="theme-toggle" onclick="toggleTheme()">◑</button>
    </div>
    <ul class="toc" id="toc"></ul>
  </nav>

  <main class="main-content">
    <header class="report-header">
      <h1>{{TITLE}}</h1>
      <div class="report-meta">{{META}}</div>
    </header>

    <article id="content">
{{BODY}}
    </article>
  </main>
</div>

<script type="module">
  // ── Mermaid ────────────────────────────────────────────
  try {
    const m = await import('https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs');
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    m.default.initialize({ startOnLoad: true, theme: isDark ? 'dark' : 'default' });
  } catch (e) {
    console.warn('Mermaid CDN unavailable:', e.message);
  }
</script>

<script>
  // ── TOC Generation ──────────────────────────────────────
  (function() {
    const headings = document.querySelectorAll('#content h1, #content h2, #content h3');
    const toc = document.getElementById('toc');
    headings.forEach(h => {
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.href = '#' + h.id;
      a.textContent = h.textContent;
      a.className = 'toc-' + h.tagName.toLowerCase();
      a.addEventListener('click', e => {
        e.preventDefault();
        h.scrollIntoView({ behavior: 'smooth' });
        document.querySelector('.sidebar').classList.remove('open');
      });
      li.appendChild(a);
      toc.appendChild(li);
    });

    // Active section tracking
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          document.querySelectorAll('.toc a').forEach(a => a.classList.remove('active'));
          const link = document.querySelector(`.toc a[href="#${entry.target.id}"]`);
          if (link) link.classList.add('active');
        }
      });
    }, { rootMargin: '-10% 0px -80% 0px' });
    headings.forEach(h => observer.observe(h));
  })();

  // ── Theme Toggle ─────────────────────────────────────────
  function toggleTheme() {
    const html = document.documentElement;
    const next = html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    html.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);

    // Re-initialize mermaid with new theme
    const mermaidEls = document.querySelectorAll('.mermaid[data-processed]');
    if (mermaidEls.length > 0) {
      location.reload(); // simplest way to re-render mermaid with new theme
    }
  }

  // Restore saved theme
  (function() {
    const saved = localStorage.getItem('theme');
    if (saved) {
      document.documentElement.setAttribute('data-theme', saved);
    } else if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
      document.documentElement.setAttribute('data-theme', 'dark');
    }
  })();
</script>
</body>
</html>"""


# ── Builder ──────────────────────────────────────────────────────────────────

DEFAULT_THEME_VARS = """
  --color-primary: #1E2761;
  --color-accent: #065A82;
  --color-bg: #ffffff;
  --color-surface: #f8f9fa;
  --color-text: #1a1a2e;
  --color-text-muted: #6c757d;
  --color-border: #dee2e6;
  --color-code-bg: #f5f5f5;
  --color-table-header: #1E2761;
  --color-blockquote-border: #065A82;
  --font-body: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  --font-code: 'JetBrains Mono', 'Fira Code', 'Consolas', monospace;
  --font-heading: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
"""


def build_html(md_text, title=None, author=None, date=None,
               primary_color=None, accent_color=None,
               font_body=None, font_code=None, template_path=None):
    """Convert markdown to a complete HTML report string."""

    # Extract title from first H1 if not provided
    if not title:
        m = re.search(r'^#\s+(.+)$', md_text, re.MULTILINE)
        title = m.group(1).strip() if m else "Report"

    # Build meta line
    meta_parts = []
    if author:
        meta_parts.append(f'<span>{html.escape(author)}</span>')
    if date:
        meta_parts.append(f'<span>{html.escape(date)}</span>')
    meta_html = " · ".join(meta_parts)

    # Build theme vars
    theme_vars = DEFAULT_THEME_VARS
    if primary_color:
        theme_vars = re.sub(
            r'--color-primary: [^;]+;',
            f'--color-primary: {primary_color};',
            theme_vars,
        )
        theme_vars = re.sub(
            r'--color-table-header: [^;]+;',
            f'--color-table-header: {primary_color};',
            theme_vars,
        )
    if accent_color:
        theme_vars = re.sub(
            r'--color-accent: [^;]+;',
            f'--color-accent: {accent_color};',
            theme_vars,
        )
    if font_body:
        theme_vars = re.sub(
            r"--font-body: [^;]+;",
            f"--font-body: {font_body};",
            theme_vars,
        )
        theme_vars = re.sub(
            r"--font-heading: [^;]+;",
            f"--font-heading: {font_body};",
            theme_vars,
        )
    if font_code:
        theme_vars = re.sub(
            r"--font-code: [^;]+;",
            f"--font-code: {font_code};",
            theme_vars,
        )

    # Convert markdown body
    body_html = md_to_html_body(md_text)

    # Load template
    if template_path and Path(template_path).exists():
        tmpl = Path(template_path).read_text(encoding="utf-8")
    else:
        tmpl = get_template()

    # Fill template
    result = tmpl.replace("{{TITLE}}", html.escape(title))
    result = result.replace("{{META}}", meta_html)
    result = result.replace("{{BODY}}", body_html)
    result = result.replace("{{THEME_VARS}}", theme_vars)

    return result


# ── CLI ──────────────────────────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser(
        description="Convert Markdown to interactive HTML report"
    )
    ap.add_argument("input", help="Markdown input file")
    ap.add_argument("-o", "--output", required=True, help="Output .html path")
    ap.add_argument("--title", help="Report title (auto-detected from H1)")
    ap.add_argument("--author", help="Author name")
    ap.add_argument("--date", help="Report date")
    ap.add_argument("--primary-color", help='Primary color (e.g. "#1E2761")')
    ap.add_argument("--accent-color", help='Accent color (e.g. "#065A82")')
    ap.add_argument("--font-body", help='Body font family')
    ap.add_argument("--font-code", help='Code font family')
    ap.add_argument("--template", help="Custom HTML template file")
    ap.add_argument("--theme", choices=["light", "dark"], default="light",
                    help="Default theme")

    args = ap.parse_args()

    md_text = Path(args.input).read_text(encoding="utf-8")

    result = build_html(
        md_text,
        title=args.title,
        author=args.author,
        date=args.date,
        primary_color=args.primary_color,
        accent_color=args.accent_color,
        font_body=args.font_body,
        font_code=args.font_code,
        template_path=args.template,
    )

    # Apply default theme
    if args.theme == "dark":
        result = result.replace('data-theme="light"', 'data-theme="dark"')

    Path(args.output).write_text(result, encoding="utf-8")
    size_kb = Path(args.output).stat().st_size / 1024
    print(f"Created: {args.output} ({size_kb:.1f} KB)")


if __name__ == "__main__":
    main()
