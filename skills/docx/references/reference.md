# python-docx API Reference

## Basic Usage

```python
from docx import Document
from docx.shared import Inches, Pt, RGBColor, Cm, Emu
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_LINE_SPACING
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.oxml.ns import qn, nsdecls
from docx.oxml import parse_xml

doc = Document()  # or Document("template.docx")
```

## Document Structure

```python
# Headings
doc.add_heading("Title", level=0)  # Document title
doc.add_heading("Chapter", level=1)
doc.add_heading("Section", level=2)

# Paragraphs
p = doc.add_paragraph("Normal text")
p = doc.add_paragraph("Bold prefix", style="List Bullet")

# Runs (inline formatting)
p = doc.add_paragraph()
run = p.add_run("bold")
run.bold = True
run = p.add_run(" and ")
run = p.add_run("italic")
run.italic = True
```

## Font Styling

```python
run.font.name = "Calibri"
run.font.size = Pt(11)
run.font.color.rgb = RGBColor(0x1E, 0x27, 0x61)
run.font.bold = True
run.font.italic = True
run.font.underline = True
```

## Paragraph Formatting

```python
p.alignment = WD_ALIGN_PARAGRAPH.CENTER  # LEFT, RIGHT, JUSTIFY
p.paragraph_format.space_before = Pt(12)
p.paragraph_format.space_after = Pt(6)
p.paragraph_format.line_spacing = 1.15
p.paragraph_format.left_indent = Cm(1.27)
p.paragraph_format.first_line_indent = Cm(0.75)
```

## Tables

```python
table = doc.add_table(rows=3, cols=4)
table.style = "Table Grid"
table.alignment = WD_TABLE_ALIGNMENT.CENTER

# Access cells
cell = table.cell(0, 0)
cell.text = "Header"

# Merge cells
cell_a = table.cell(0, 0)
cell_b = table.cell(0, 1)
cell_a.merge(cell_b)

# Cell shading
from docx.oxml.ns import nsdecls
from docx.oxml import parse_xml
shading = parse_xml(f'<w:shd {nsdecls("w")} w:fill="1E2761" w:val="clear"/>')
cell._element.get_or_add_tcPr().append(shading)

# Column widths
table.columns[0].width = Inches(2)
```

## Images

```python
doc.add_picture("image.png", width=Inches(5))
last_paragraph = doc.paragraphs[-1]
last_paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
```

## Page Breaks and Sections

```python
doc.add_page_break()

# Section properties (margins, orientation)
section = doc.sections[0]
section.page_width = Inches(8.5)
section.page_height = Inches(11)
section.top_margin = Inches(1)
section.bottom_margin = Inches(1)
section.left_margin = Inches(1)
section.right_margin = Inches(1)
```

## Headers and Footers

```python
section = doc.sections[0]
header = section.header
header.is_linked_to_previous = False
p = header.paragraphs[0]
p.text = "Document Header"
p.alignment = WD_ALIGN_PARAGRAPH.RIGHT

footer = section.footer
footer.is_linked_to_previous = False
p = footer.paragraphs[0]
p.text = "Page "
# Add page number field
run = p.add_run()
fldChar = parse_xml(f'<w:fldChar {nsdecls("w")} w:fldCharType="begin"/>')
run._element.append(fldChar)
run = p.add_run()
instrText = parse_xml(f'<w:instrText {nsdecls("w")} xml:space="preserve"> PAGE </w:instrText>')
run._element.append(instrText)
run = p.add_run()
fldChar = parse_xml(f'<w:fldChar {nsdecls("w")} w:fldCharType="end"/>')
run._element.append(fldChar)
```

## Table of Contents (Field Code)

```python
paragraph = doc.add_paragraph()
run = paragraph.add_run()
fldChar = parse_xml(f'<w:fldChar {nsdecls("w")} w:fldCharType="begin"/>')
run._element.append(fldChar)

run = paragraph.add_run()
instrText = parse_xml(
    f'<w:instrText {nsdecls("w")} xml:space="preserve"> TOC \\o "1-3" \\h \\z \\u </w:instrText>'
)
run._element.append(instrText)

run = paragraph.add_run()
fldChar = parse_xml(f'<w:fldChar {nsdecls("w")} w:fldCharType="separate"/>')
run._element.append(fldChar)

run = paragraph.add_run("(Update field to generate)")
run = paragraph.add_run()
fldChar = parse_xml(f'<w:fldChar {nsdecls("w")} w:fldCharType="end"/>')
run._element.append(fldChar)
```

## Borders

```python
# Paragraph bottom border
pPr = p._element.get_or_add_pPr()
pBdr = parse_xml(
    f'<w:pBdr {nsdecls("w")}>'
    f'<w:bottom w:val="single" w:sz="6" w:space="1" w:color="CCCCCC"/>'
    f'</w:pBdr>'
)
pPr.append(pBdr)
```

## Styles

```python
# Modify existing style
style = doc.styles["Normal"]
style.font.name = "Calibri"
style.font.size = Pt(11)

# Create custom style
from docx.enum.style import WD_STYLE_TYPE
style = doc.styles.add_style("CodeBlock", WD_STYLE_TYPE.PARAGRAPH)
style.font.name = "Consolas"
style.font.size = Pt(9)
style.paragraph_format.space_before = Pt(6)
style.paragraph_format.space_after = Pt(6)
```

## Reading Existing Documents

```python
doc = Document("existing.docx")

# Read all paragraphs
for p in doc.paragraphs:
    print(p.style.name, p.text)

# Read tables
for table in doc.tables:
    for row in table.rows:
        for cell in row.cells:
            print(cell.text)

# Save modified
doc.save("modified.docx")
```
