#!/usr/bin/env python3
"""
create_docx.py — Create professional DOCX from Markdown or JSON input.

Usage:
  python create_docx.py --md report.md -o report.docx
  python create_docx.py --json data.json -o report.docx
  python create_docx.py --md report.md --template brand.docx -o report.docx

Requirements:
  pip install python-docx
"""

import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

try:
    from docx import Document
    from docx.shared import Inches, Pt, RGBColor, Cm
    from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_LINE_SPACING
    from docx.enum.table import WD_TABLE_ALIGNMENT
    from docx.oxml.ns import qn, nsdecls
    from docx.oxml import parse_xml
except ImportError:
    sys.exit("python-docx not installed. Run: pip install python-docx")


# ── Style Constants ──────────────────────────────────────────────────────────

FONT_BODY = "Calibri"
FONT_HEADING = "Calibri"
FONT_CODE = "Consolas"
COLOR_PRIMARY = RGBColor(0x1E, 0x27, 0x61)
COLOR_ACCENT = RGBColor(0x06, 0x5A, 0x82)
COLOR_MUTED = RGBColor(0x66, 0x66, 0x66)
COLOR_CODE_BG = "F5F5F5"
COLOR_TABLE_HEADER_BG = "1E2761"
COLOR_TABLE_ALT_BG = "F0F4F8"


# ── DocxBuilder ──────────────────────────────────────────────────────────────

class DocxBuilder:
    """Build professional DOCX documents with consistent styling."""

    def __init__(self, template_path=None):
        if template_path and Path(template_path).exists():
            self.doc = Document(template_path)
        else:
            self.doc = Document()
        self._setup_styles()

    def _setup_styles(self):
        style = self.doc.styles["Normal"]
        style.font.name = FONT_BODY
        style.font.size = Pt(11)
        style.paragraph_format.space_after = Pt(6)
        style.paragraph_format.line_spacing_rule = WD_LINE_SPACING.MULTIPLE
        style.paragraph_format.line_spacing = 1.15

        for level in range(1, 5):
            name = f"Heading {level}"
            if name in self.doc.styles:
                h = self.doc.styles[name]
                h.font.name = FONT_HEADING
                h.font.color.rgb = COLOR_PRIMARY
                h.font.bold = True
                h.font.size = Pt({1: 24, 2: 18, 3: 14, 4: 12}[level])

    # ── Title Page ───────────────────────────────────────────────────────

    def add_title_page(self, title, subtitle=None, author=None, date=None):
        for _ in range(6):
            self.doc.add_paragraph()

        p = self.doc.add_paragraph()
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        run = p.add_run(title)
        run.font.size = Pt(36)
        run.font.color.rgb = COLOR_PRIMARY
        run.bold = True

        if subtitle:
            p = self.doc.add_paragraph()
            p.alignment = WD_ALIGN_PARAGRAPH.CENTER
            run = p.add_run(subtitle)
            run.font.size = Pt(18)
            run.font.color.rgb = COLOR_ACCENT

        if author or date:
            self.doc.add_paragraph()
            p = self.doc.add_paragraph()
            p.alignment = WD_ALIGN_PARAGRAPH.CENTER
            parts = [x for x in [author, date] if x]
            run = p.add_run(" | ".join(parts))
            run.font.size = Pt(12)
            run.font.color.rgb = COLOR_MUTED

        self.doc.add_page_break()

    # ── Table of Contents ────────────────────────────────────────────────

    def add_toc(self):
        p = self.doc.add_paragraph()
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        run = p.add_run("Table of Contents")
        run.font.size = Pt(24)
        run.font.color.rgb = COLOR_PRIMARY
        run.bold = True

        paragraph = self.doc.add_paragraph()
        run = paragraph.add_run()
        fld_begin = parse_xml(
            f'<w:fldChar {nsdecls("w")} w:fldCharType="begin"/>'
        )
        run._element.append(fld_begin)

        run = paragraph.add_run()
        instr = parse_xml(
            f'<w:instrText {nsdecls("w")} xml:space="preserve">'
            f' TOC \\o "1-3" \\h \\z \\u </w:instrText>'
        )
        run._element.append(instr)

        run = paragraph.add_run()
        fld_sep = parse_xml(
            f'<w:fldChar {nsdecls("w")} w:fldCharType="separate"/>'
        )
        run._element.append(fld_sep)

        run = paragraph.add_run(
            "(Right-click → Update Field to generate TOC)"
        )
        run.font.color.rgb = RGBColor(0x99, 0x99, 0x99)
        run.font.size = Pt(10)

        run = paragraph.add_run()
        fld_end = parse_xml(
            f'<w:fldChar {nsdecls("w")} w:fldCharType="end"/>'
        )
        run._element.append(fld_end)

        self.doc.add_page_break()

    # ── Content Elements ─────────────────────────────────────────────────

    def add_heading(self, text, level=1):
        self.doc.add_heading(text, level=min(level, 4))

    def add_paragraph(self, text):
        p = self.doc.add_paragraph()
        self._add_formatted_runs(p, text)
        return p

    def add_code_block(self, code, language=""):
        """Code block: monospace font inside a shaded table cell."""
        table = self.doc.add_table(rows=1, cols=1)
        table.alignment = WD_TABLE_ALIGNMENT.CENTER
        cell = table.cell(0, 0)

        shading = parse_xml(
            f'<w:shd {nsdecls("w")} w:fill="{COLOR_CODE_BG}" w:val="clear"/>'
        )
        cell._element.get_or_add_tcPr().append(shading)

        p = cell.paragraphs[0]
        if language:
            run = p.add_run(f"{language.upper()}\n")
            run.font.size = Pt(8)
            run.font.color.rgb = RGBColor(0x99, 0x99, 0x99)
            run.font.name = FONT_CODE

        for i, line in enumerate(code.strip().split("\n")):
            run = p.add_run(line)
            run.font.name = FONT_CODE
            run.font.size = Pt(9)
            if i < len(code.strip().split("\n")) - 1:
                p.add_run("\n")

        p.paragraph_format.space_before = Pt(2)
        p.paragraph_format.space_after = Pt(2)
        self.doc.add_paragraph()  # spacing

    def add_table(self, headers, rows):
        """Styled table with header row and alternating bands."""
        if not headers:
            return
        table = self.doc.add_table(
            rows=1 + len(rows), cols=len(headers)
        )
        table.alignment = WD_TABLE_ALIGNMENT.CENTER
        table.style = "Table Grid"

        # Header
        for i, h in enumerate(headers):
            cell = table.cell(0, i)
            cell.text = str(h)
            for para in cell.paragraphs:
                para.alignment = WD_ALIGN_PARAGRAPH.CENTER
                for run in para.runs:
                    run.font.bold = True
                    run.font.color.rgb = RGBColor(0xFF, 0xFF, 0xFF)
                    run.font.size = Pt(10)
            shading = parse_xml(
                f'<w:shd {nsdecls("w")} w:fill="{COLOR_TABLE_HEADER_BG}" '
                f'w:val="clear"/>'
            )
            cell._element.get_or_add_tcPr().append(shading)

        # Data rows
        for ri, row in enumerate(rows):
            for ci, val in enumerate(row):
                cell = table.cell(ri + 1, ci)
                cell.text = str(val)
                for para in cell.paragraphs:
                    for run in para.runs:
                        run.font.size = Pt(10)
                if ri % 2 == 1:
                    shading = parse_xml(
                        f'<w:shd {nsdecls("w")} '
                        f'w:fill="{COLOR_TABLE_ALT_BG}" w:val="clear"/>'
                    )
                    cell._element.get_or_add_tcPr().append(shading)

        self.doc.add_paragraph()

    def add_image(self, path, width=6.0, caption=None):
        if not Path(path).exists():
            self.add_paragraph(f"[Image not found: {path}]")
            return
        self.doc.add_picture(str(path), width=Inches(width))
        self.doc.paragraphs[-1].alignment = WD_ALIGN_PARAGRAPH.CENTER
        if caption:
            p = self.doc.add_paragraph()
            p.alignment = WD_ALIGN_PARAGRAPH.CENTER
            run = p.add_run(caption)
            run.font.size = Pt(9)
            run.font.italic = True
            run.font.color.rgb = COLOR_MUTED

    def add_mermaid(self, code, caption=None):
        """Try mmdc for PNG rendering, fall back to code block."""
        png = self._render_mermaid_png(code)
        if png:
            self.add_image(png, width=5.5, caption=caption)
            try:
                os.unlink(png)
            except OSError:
                pass
        else:
            self.add_code_block(code, "mermaid")
            if caption:
                p = self.doc.add_paragraph()
                p.alignment = WD_ALIGN_PARAGRAPH.CENTER
                run = p.add_run(
                    f"{caption} (install @mermaid-js/mermaid-cli for image)"
                )
                run.font.size = Pt(9)
                run.font.italic = True
                run.font.color.rgb = COLOR_MUTED

    def add_bullet_list(self, items):
        for item in items:
            p = self.doc.add_paragraph(style="List Bullet")
            self._add_formatted_runs(p, item)

    def add_numbered_list(self, items):
        for item in items:
            p = self.doc.add_paragraph(style="List Number")
            self._add_formatted_runs(p, item)

    def add_blockquote(self, text):
        p = self.doc.add_paragraph()
        p.paragraph_format.left_indent = Cm(1.27)
        # Left border via XML
        pPr = p._element.get_or_add_pPr()
        pBdr = parse_xml(
            f'<w:pBdr {nsdecls("w")}>'
            f'<w:left w:val="single" w:sz="12" w:space="8" '
            f'w:color="065A82"/>'
            f'</w:pBdr>'
        )
        pPr.append(pBdr)
        run = p.add_run(text)
        run.font.italic = True
        run.font.color.rgb = COLOR_MUTED

    def add_horizontal_rule(self):
        p = self.doc.add_paragraph()
        pPr = p._element.get_or_add_pPr()
        pBdr = parse_xml(
            f'<w:pBdr {nsdecls("w")}>'
            f'<w:bottom w:val="single" w:sz="6" w:space="1" '
            f'w:color="CCCCCC"/>'
            f'</w:pBdr>'
        )
        pPr.append(pBdr)

    def add_page_break(self):
        self.doc.add_page_break()

    def save(self, path):
        self.doc.save(str(path))
        size_kb = Path(path).stat().st_size / 1024
        print(f"Created: {path} ({size_kb:.1f} KB)")

    # ── Helpers ──────────────────────────────────────────────────────────

    def _add_formatted_runs(self, paragraph, text):
        """Parse inline markdown: **bold**, *italic*, `code`."""
        pattern = (
            r'(\*\*\*(.+?)\*\*\*'
            r'|\*\*(.+?)\*\*'
            r'|\*(.+?)\*'
            r'|`(.+?)`'
            r'|([^*`]+))'
        )
        for m in re.finditer(pattern, text):
            if m.group(2):       # ***bold italic***
                run = paragraph.add_run(m.group(2))
                run.bold = True
                run.italic = True
            elif m.group(3):     # **bold**
                run = paragraph.add_run(m.group(3))
                run.bold = True
            elif m.group(4):     # *italic*
                run = paragraph.add_run(m.group(4))
                run.italic = True
            elif m.group(5):     # `code`
                run = paragraph.add_run(m.group(5))
                run.font.name = FONT_CODE
                run.font.size = Pt(10)
                shd = parse_xml(
                    f'<w:shd {nsdecls("w")} '
                    f'w:fill="{COLOR_CODE_BG}" w:val="clear"/>'
                )
                run._element.get_or_add_rPr().append(shd)
            elif m.group(6):     # plain
                paragraph.add_run(m.group(6))

    @staticmethod
    def _render_mermaid_png(code):
        """Render mermaid code to PNG via mmdc. Returns path or None."""
        try:
            mmd = tempfile.NamedTemporaryFile(
                suffix=".mmd", mode="w", delete=False, encoding="utf-8"
            )
            mmd.write(code)
            mmd.close()
            png_path = mmd.name.replace(".mmd", ".png")

            result = subprocess.run(
                ["mmdc", "-i", mmd.name, "-o", png_path,
                 "-b", "transparent", "-s", "2"],
                capture_output=True, text=True, timeout=30,
            )
            os.unlink(mmd.name)
            if result.returncode == 0 and Path(png_path).exists():
                return png_path
            return None
        except (FileNotFoundError, subprocess.TimeoutExpired, OSError):
            return None


# ── Markdown Parser ──────────────────────────────────────────────────────────

def parse_markdown(text):
    """Parse markdown into a list of typed elements."""
    lines = text.split("\n")
    elements = []
    i = 0

    while i < len(lines):
        line = lines[i]

        # Heading
        m = re.match(r'^(#{1,4})\s+(.+)$', line)
        if m:
            elements.append({
                "type": "heading",
                "level": len(m.group(1)),
                "text": m.group(2).strip(),
            })
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
                i += 1  # skip closing
            code = "\n".join(code_lines)
            if lang == "mermaid":
                elements.append({"type": "mermaid", "code": code})
            else:
                elements.append({
                    "type": "code", "language": lang, "code": code
                })
            continue

        # Table (header | sep | rows)
        if ("|" in line
                and i + 1 < len(lines)
                and re.match(r'^\|[\s\-:|]+\|', lines[i + 1])):
            headers = [c.strip() for c in line.split("|")[1:-1]]
            i += 2
            rows = []
            while i < len(lines) and "|" in lines[i]:
                row = [c.strip() for c in lines[i].split("|")[1:-1]]
                rows.append(row)
                i += 1
            elements.append({
                "type": "table", "headers": headers, "rows": rows
            })
            continue

        # Bullet list
        if re.match(r'^[\s]*[-*+]\s', line):
            items = []
            while i < len(lines) and re.match(r'^[\s]*[-*+]\s', lines[i]):
                items.append(re.sub(r'^[\s]*[-*+]\s', '', lines[i]))
                i += 1
            elements.append({"type": "bullet_list", "items": items})
            continue

        # Numbered list
        if re.match(r'^[\s]*\d+[.)]\s', line):
            items = []
            while i < len(lines) and re.match(r'^[\s]*\d+[.)]\s', lines[i]):
                items.append(re.sub(r'^[\s]*\d+[.)]\s', '', lines[i]))
                i += 1
            elements.append({"type": "numbered_list", "items": items})
            continue

        # Horizontal rule
        if re.match(r'^[\s]*[-*_]{3,}[\s]*$', line):
            elements.append({"type": "hr"})
            i += 1
            continue

        # Blockquote
        if line.startswith(">"):
            quote = []
            while i < len(lines) and lines[i].startswith(">"):
                quote.append(lines[i].lstrip("> "))
                i += 1
            elements.append({
                "type": "blockquote", "text": "\n".join(quote)
            })
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
                   and not re.match(r'^[\s]*[-*_]{3,}[\s]*$', lines[i])):
                para.append(lines[i].strip())
                i += 1
            elements.append({"type": "paragraph", "text": " ".join(para)})
            continue

        i += 1

    return elements


# ── Build Functions ──────────────────────────────────────────────────────────

def build_from_json(data, output, template=None):
    b = DocxBuilder(template)
    b.add_title_page(
        title=data.get("title", "Report"),
        subtitle=data.get("subtitle"),
        author=data.get("author"),
        date=data.get("date"),
    )
    if data.get("toc", True):
        b.add_toc()

    for sec in data.get("sections", []):
        if "heading" in sec:
            b.add_heading(sec["heading"], sec.get("level", 1))
        if "content" in sec:
            for para in sec["content"].split("\n\n"):
                if para.strip():
                    b.add_paragraph(para.strip())
        if "code" in sec:
            c = sec["code"]
            if isinstance(c, dict):
                b.add_code_block(c.get("source", ""), c.get("language", ""))
            else:
                b.add_code_block(str(c))
        if "mermaid" in sec:
            b.add_mermaid(sec["mermaid"], sec.get("diagram_caption"))
        if "table" in sec:
            t = sec["table"]
            b.add_table(t["headers"], t["rows"])
        if "bullets" in sec:
            b.add_bullet_list(sec["bullets"])
        if "numbered" in sec:
            b.add_numbered_list(sec["numbered"])
        if "image" in sec:
            img = sec["image"]
            if isinstance(img, dict):
                b.add_image(img["path"], img.get("width", 6.0),
                            img.get("caption"))
            else:
                b.add_image(str(img))
        if sec.get("page_break"):
            b.add_page_break()

    b.save(output)


def build_from_markdown(md_text, output, template=None,
                        title=None, author=None, date=None):
    b = DocxBuilder(template)
    elements = parse_markdown(md_text)

    # Auto-detect title from first H1
    if not title:
        for el in elements:
            if el["type"] == "heading" and el["level"] == 1:
                title = el["text"]
                break
        title = title or "Report"

    b.add_title_page(title=title, author=author, date=date)
    b.add_toc()

    for el in elements:
        t = el["type"]
        if t == "heading":
            b.add_heading(el["text"], el["level"])
        elif t == "paragraph":
            b.add_paragraph(el["text"])
        elif t == "code":
            b.add_code_block(el["code"], el.get("language", ""))
        elif t == "mermaid":
            b.add_mermaid(el["code"])
        elif t == "table":
            b.add_table(el["headers"], el["rows"])
        elif t == "bullet_list":
            b.add_bullet_list(el["items"])
        elif t == "numbered_list":
            b.add_numbered_list(el["items"])
        elif t == "blockquote":
            b.add_blockquote(el["text"])
        elif t == "hr":
            b.add_horizontal_rule()

    b.save(output)


# ── CLI ──────────────────────────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser(
        description="Create professional DOCX from Markdown or JSON"
    )
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument("--md", metavar="FILE", help="Markdown input file")
    src.add_argument("--json", metavar="FILE", help="JSON input file")

    ap.add_argument("-o", "--output", required=True, help="Output .docx path")
    ap.add_argument("--template", help="Template .docx for custom styles")
    ap.add_argument("--title", help="Document title")
    ap.add_argument("--author", help="Document author")
    ap.add_argument("--date", help="Document date")

    args = ap.parse_args()

    if args.json:
        with open(args.json, "r", encoding="utf-8") as f:
            build_from_json(json.load(f), args.output, args.template)
    else:
        with open(args.md, "r", encoding="utf-8") as f:
            build_from_markdown(
                f.read(), args.output, args.template,
                args.title, args.author, args.date,
            )


if __name__ == "__main__":
    main()
