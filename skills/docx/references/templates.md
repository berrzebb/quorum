# DOCX Template Guide

## How Templates Work

When `--template brand.docx` is provided, the script opens the template document and builds content on top of it. The template's styles, fonts, colors, headers, footers, and margins are all preserved.

## Creating a Template

1. Open Word (or LibreOffice Writer)
2. Set up your desired styles:
   - **Normal**: body text font, size, color, spacing
   - **Heading 1-4**: heading fonts, sizes, colors
   - **List Bullet** / **List Number**: list indentation and markers
   - **Table Grid**: table borders and cell padding
3. Set page margins, headers, footers
4. Add a logo in the header if desired
5. Save as `.docx`

The template should contain no body content — just style definitions and header/footer setup.

## Style Names (Must Match)

The script uses these built-in style names:

| Style Name | Used For |
|------------|----------|
| `Normal` | Body paragraphs |
| `Heading 1` | Top-level sections |
| `Heading 2` | Sub-sections |
| `Heading 3` | Sub-sub-sections |
| `Heading 4` | Minor headings |
| `List Bullet` | Unordered lists |
| `List Number` | Ordered lists |
| `Table Grid` | Table styling |

If your template defines these styles, the script will use them. If not, it falls back to defaults.

## Example: Corporate Template

```
corporate-template.docx
├── Header: Company logo (left) + Document title (right)
├── Footer: Page number (center) + "Confidential" (right)
├── Margins: 1" all sides
├── Heading 1: Montserrat Bold 24pt, #003366
├── Heading 2: Montserrat Bold 16pt, #003366
├── Normal: Open Sans 11pt, #333333, 1.15 line spacing
└── Table Grid: #003366 header, alternating #F5F8FC rows
```

## Usage

```bash
python skills/docx/scripts/create_docx.py \
  --md report.md \
  --template templates/corporate.docx \
  -o report.docx
```

## Tips

- Test your template by generating a short document first
- Include all heading levels you plan to use (even if empty) so Word registers the styles
- Headers/footers persist across the generated document
- The script's color constants (COLOR_PRIMARY, etc.) are overridden by template styles when a template is provided
