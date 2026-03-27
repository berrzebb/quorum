---
name: quorum:pdf
description: "Process PDF files — read, create, merge, split, rotate, watermark, extract text/tables/images, fill forms, encrypt/decrypt, and OCR scanned PDFs. Use this skill whenever a .pdf file is involved as input or output, or when the user mentions PDF processing. Triggers on 'PDF', '.pdf', 'merge PDF', 'split PDF', 'extract text', 'fill form', 'create PDF', 'PDF 생성', 'PDF 합치기', 'PDF 나누기', 'PDF 양식', '텍스트 추출'."
argument-hint: "<operation: read|create|merge|split|form|ocr>"
model: claude-sonnet-4-6
allowed-tools: Read, Write, Bash(python *), Bash(pip *), Bash(qpdf *), Bash(pdftk *)
---

# PDF Processing (Claude Code)

## Tool Mapping

| Operation | Tool |
|-----------|------|
| Read file | `Read` |
| Write file | `Write` |
| Run Python | `Bash` |

## Start

Read and follow the canonical skill at `skills/pdf/SKILL.md`.
Scripts are at `skills/pdf/scripts/`.
