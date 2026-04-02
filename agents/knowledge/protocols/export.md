# Export Protocol

Generate project documents in various formats.

## Formats

| Format | Description | Scripts | References |
|--------|-------------|---------|------------|
| `pdf` | PDF read/create/merge/split/form/OCR | `scripts/export/pdf/` | `references/export/pdf/` |
| `pptx` | PowerPoint with design rules, pptxgenjs | `scripts/export/pptx/` | `references/export/pptx/` |
| `docx` | Word from markdown/JSON | `scripts/export/docx/` | `references/export/docx/` |
| `html` | Interactive HTML report, dark/light mode | `scripts/export/html/` | `references/export/html/` |
| `report` | Project completion report with diagrams | — | — |

## Format: PDF

Key tools: pypdf, pdfplumber, reportlab, qpdf. Read `references/export/pdf/reference.md` for detailed patterns.

## Format: PPTX

Key tools: pptxgenjs (Node.js), python-pptx. Read `references/export/pptx/pptxgenjs.md`.

Design rules: professional palette, title 28pt+, body 18pt+, max 6 bullets per slide.

## Format: DOCX

Key tools: python-docx, pandoc. Script: `scripts/export/docx/create_docx.py`.

## Format: HTML

Single self-contained HTML with dark/light mode, sidebar TOC, syntax highlighting, mermaid rendering. Script: `scripts/export/html/md_to_html.py`.

## Format: Report

### Required Sections

| Section | Content | Visual |
|---------|---------|--------|
| Executive Summary | Goals, scope, outcome | Mermaid timeline |
| Architecture | System structure | Mermaid architecture |
| Quality Metrics | CQ/T/CC/CL/S/I/FV/CV | Mermaid radar |
| Track Status | WB completion, verdicts | Mermaid gantt |
| Risk & Residual | Known issues, deferred | Table |
| Learnings | Auto-learn patterns | Bullet list |

### Data Sources

```
quorum tool audit_history
quorum tool rtm_parse
quorum tool coverage_map
quorum tool contract_drift
```

After report markdown, chain with `--pdf`, `--pptx`, `--docx`, `--html` for format conversion.
