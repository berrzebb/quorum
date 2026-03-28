---
name: quorum:pptx
description: "Create, read, edit, and process PowerPoint (.pptx) files. Includes design guidelines for professional presentations, template editing, and from-scratch creation with pptxgenjs. Use this skill whenever a .pptx file is involved — reading content, creating decks, editing slides, combining files, or working with templates and speaker notes. Triggers on 'pptx', 'PowerPoint', 'presentation', 'deck', 'slides', '프레젠테이션', '발표 자료', '슬라이드', 'PPT'."
argument-hint: "<operation: read|create|edit|template>"
---

# PPTX Processing

## Quick Reference

| Task | Approach | Detail |
|------|----------|--------|
| Read/analyze content | `python -m markitdown presentation.pptx` | Text extraction |
| Visual overview | `python scripts/thumbnail.py presentation.pptx` | Thumbnail grid |
| Edit existing / use template | Read `references/editing.md` | Unpack → edit XML → pack |
| Create from scratch | Read `references/pptxgenjs.md` | Node.js pptxgenjs library |
| Raw XML inspection | `python scripts/office/unpack.py file.pptx dir/` | Extract OOXML |

## Workflow

1. **Identify the operation** from the table above
2. **Read the appropriate reference**:
   - Editing existing: `platform/skills/pptx/references/editing.md`
   - Creating from scratch: `platform/skills/pptx/references/pptxgenjs.md`
3. **Follow design guidelines** below for professional results
4. **QA is mandatory** — never declare success without verification

## Design Guidelines

### Before Starting

- **Pick a bold, content-informed color palette** — it should feel designed for THIS topic
- **Dominance over equality** — one color dominates (60-70%), with 1-2 supporting tones and one accent
- **Dark/light contrast** — dark backgrounds for title + conclusion, light for content
- **Commit to a visual motif** — one distinctive element repeated across all slides

### Color Palettes

| Theme | Primary | Secondary | Accent |
|-------|---------|-----------|--------|
| Midnight Executive | `1E2761` | `CADCFC` | `FFFFFF` |
| Forest & Moss | `2C5F2D` | `97BC62` | `F5F5F5` |
| Coral Energy | `F96167` | `F9E795` | `2F3C7E` |
| Warm Terracotta | `B85042` | `E7E8D1` | `A7BEAE` |
| Ocean Gradient | `065A82` | `1C7293` | `21295C` |
| Charcoal Minimal | `36454F` | `F2F2F2` | `212121` |

### Per-Slide Rules

- **Every slide needs a visual element** — image, chart, icon, or shape. No text-only slides.
- **Layout options**: two-column, icon+text rows, 2x2 grid, half-bleed image
- **Data display**: large stat callouts (60-72pt), comparison columns, timeline/process flow
- **Typography**: header 36-44pt bold, body 14-16pt, captions 10-12pt
- **Spacing**: 0.5" minimum margins, 0.3-0.5" between blocks

### Avoid

- Don't repeat the same layout across slides
- Don't center body text — left-align; center only titles
- Don't default to blue — pick topic-specific colors
- Don't create text-only slides
- **Never use accent lines under titles** — hallmark of AI-generated slides

## QA (Required)

**Assume there are problems. Find them.**

### Content QA

```bash
python -m markitdown output.pptx
python -m markitdown output.pptx | grep -iE "xxxx|lorem|ipsum"  # leftover placeholders
```

### Visual QA

Convert to images and inspect:

```bash
python scripts/office/soffice.py --headless --convert-to pdf output.pptx
pdftoppm -jpeg -r 150 output.pdf slide
```

Look for: overlapping elements, text overflow, uneven gaps, low contrast, leftover placeholders.

### Verification Loop

1. Generate → Convert to images → Inspect
2. List issues (if none found, look harder)
3. Fix → Re-verify affected slides
4. Repeat until clean pass

## Bundled Scripts

Located at `platform/skills/pptx/scripts/`:

| Script | Purpose |
|--------|---------|
| `thumbnail.py` | Generate thumbnail grid of all slides |
| `add_slide.py` | Programmatically add slides |
| `clean.py` | Clean XML artifacts |
| `office/unpack.py` | Extract OOXML from .pptx |
| `office/pack.py` | Re-pack OOXML into .pptx |
| `office/soffice.py` | LibreOffice headless conversion |
| `office/validate.py` | Validate OOXML against schemas |

## Dependencies

```bash
pip install "markitdown[pptx]" Pillow   # Reading and thumbnails
npm install -g pptxgenjs                 # Creating from scratch
# LibreOffice (soffice) for PDF conversion
# Poppler (pdftoppm) for PDF to images
```

## References

| Reference | When to read |
|-----------|-------------|
| `references/editing.md` | Template editing — unpack/manipulate/pack workflow |
| `references/pptxgenjs.md` | From-scratch creation with pptxgenjs (Node.js) |
