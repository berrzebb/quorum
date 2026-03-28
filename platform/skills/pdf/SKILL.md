---
name: quorum:pdf
description: "Process PDF files — read, create, merge, split, rotate, watermark, extract text/tables/images, fill forms, encrypt/decrypt, and OCR scanned PDFs. Use this skill whenever a .pdf file is involved as input or output, or when the user mentions PDF processing. Triggers on 'PDF', '.pdf', 'merge PDF', 'split PDF', 'extract text', 'fill form', 'create PDF', 'PDF 생성', 'PDF 합치기', 'PDF 나누기', 'PDF 양식', '텍스트 추출'."
argument-hint: "<operation: read|create|merge|split|form|ocr>"
---

# PDF Processing

## Quick Reference

| Task | Best Tool | Detail |
|------|-----------|--------|
| Extract text | pdfplumber | `page.extract_text()` |
| Extract tables | pdfplumber | `page.extract_tables()` |
| Merge PDFs | pypdf | `PdfWriter.add_page()` |
| Split PDFs | pypdf | One page per file |
| Create PDFs | reportlab | Canvas or Platypus |
| Fill PDF forms | See references/forms.md | pypdf or pdf-lib |
| OCR scanned PDFs | pytesseract + pdf2image | Convert to image first |
| Command-line ops | qpdf / pdftk | Merge, split, rotate, decrypt |
| Extract images | pdfimages (poppler-utils) | `pdfimages -j input.pdf prefix` |
| Password protection | pypdf | `writer.encrypt()` |
| Add watermark | pypdf | `page.merge_page(watermark)` |
| Rotate pages | pypdf | `page.rotate(90)` |

## Workflow

1. **Identify the operation** from the table above
2. **Read the appropriate reference** for detailed code patterns:
   - General operations: `platform/skills/pdf/references/reference.md`
   - Form filling: `platform/skills/pdf/references/forms.md`
3. **Use bundled scripts** for form processing (see Scripts below)
4. **Verify output** — always check the result with `pdfplumber` or visual inspection

## Key Libraries

```bash
pip install pypdf pdfplumber reportlab   # Core Python libraries
pip install pytesseract pdf2image         # OCR support
```

Command-line: `qpdf`, `pdftk`, `pdftotext` (poppler-utils), `pdfimages`

## Important Notes

- **Unicode subscripts/superscripts**: Never use Unicode chars (₀₁₂₃) in ReportLab — they render as black boxes. Use `<sub>` and `<super>` tags in Paragraph objects.
- **Scanned PDFs**: Must convert to images first with `pdf2image`, then OCR with `pytesseract`.
- **Form filling**: Read `references/forms.md` first — there are two approaches (fillable fields vs. annotation overlay) depending on the PDF type.

## Bundled Scripts

Located at `platform/skills/pdf/scripts/`:

| Script | Purpose |
|--------|---------|
| `check_fillable_fields.py` | Detect if PDF has fillable form fields |
| `extract_form_field_info.py` | Extract field names, types, positions |
| `extract_form_structure.py` | Full form structure analysis |
| `fill_fillable_fields.py` | Fill native PDF form fields |
| `fill_pdf_form_with_annotations.py` | Fill non-fillable forms via annotation overlay |
| `check_bounding_boxes.py` | Verify field bounding boxes |
| `convert_pdf_to_images.py` | Convert PDF pages to images (for QA) |
| `create_validation_image.py` | Create visual validation overlay |

## References

| Reference | When to read |
|-----------|-------------|
| `references/reference.md` | Detailed code for all operations (pypdf, pdfplumber, reportlab, JS pdf-lib) |
| `references/forms.md` | Form filling workflow — read this before filling any form |
