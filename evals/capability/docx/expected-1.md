# Expected Quality Standards — DOCX Document

1. **Proper Document Structure**: The DOCX must include a title page (or prominent title heading), a table of contents or section overview, and clearly separated sections for PRD Summary, Requirements, Work Breakdown, and Dependencies. Heading levels must be used correctly (H1 for sections, H2 for subsections).

2. **Content Sourced from Track Data**: All content must be derived from actual track planning files (PRD, WB definitions) in the `.claude/quorum/planning/` directory or equivalent. The PRD summary must reflect the actual requirements, not generic placeholder text. Track name ("user-auth") must appear in the document.

3. **WB Summary Table**: The document must include a formatted table summarizing all Work Breakdown items with at minimum these columns: WB ID, Name/Title, Size (XS/S/M), Phase, and Dependencies. The table must be a proper Word table (not plain text with spacing).

4. **Consistent Professional Formatting**: The document must use consistent fonts, heading styles, and spacing throughout. Tables must have header rows with distinct formatting (bold or shaded). Body text must be readable (11-12pt, standard font). No raw markdown or code formatting artifacts.

5. **Valid DOCX Output**: The generated file must be a valid DOCX that opens without errors in Microsoft Word and LibreOffice Writer. The skill must use a proper DOCX library (e.g., docx, officegen, or pandoc conversion). Corrupt or zero-byte files are a failure.

6. **Accurate Data Representation**: All WB items listed must correspond to actual items in the track. Counts, phase numbers, and dependency references must be accurate. No invented WB items or fabricated requirement text.
