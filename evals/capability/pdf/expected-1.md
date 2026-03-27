# Expected Quality Standards — PDF Report

1. **Structured Sections**: The generated PDF must contain clearly delineated sections: Executive Summary, Audit Verdicts (per session), Detailed Findings, Timeline/Chronology, and Recommendations. Each section must have a visible heading and logical content flow.

2. **Data Sourced from Audit History**: All audit data must be retrieved using the `audit_history` MCP tool or by querying the SQLite event store directly. The report must not contain fabricated or placeholder data. Session IDs, timestamps, verdict outcomes, and finding counts must match the actual stored records.

3. **Pass/Fail Statistics**: The report must include quantitative statistics: total sessions audited, pass count, fail count, pass rate percentage, and per-session verdict (PASS/FAIL/PARTIAL). Numbers must be arithmetically consistent (e.g., pass + fail = total).

4. **Readability and Formatting**: The PDF must be formatted for human readability: consistent font sizes for headings vs body, adequate margins, table formatting for tabular data (findings, verdicts), and page breaks between major sections. Raw JSON or unformatted dumps are not acceptable.

5. **Valid PDF Generation**: The skill must use a legitimate PDF generation approach (e.g., pdfkit, puppeteer HTML-to-PDF, or jsPDF). The output must be a valid PDF file that opens in standard PDF readers. The generation code must handle errors (missing data, empty sessions) without producing corrupt files.

6. **Output Path Communication**: The final PDF file path must be clearly communicated to the user. The file should be written to a predictable location (e.g., `.claude/reports/` or project root) with a descriptive filename that includes a timestamp or session range identifier.
