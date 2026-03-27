# Expected Quality Standards — PPTX Presentation

1. **Logical Slide Progression**: The presentation must follow a coherent narrative arc: Title Slide → Executive Overview → Audit Summary Metrics → Quality Trends Over Time → Domain-Specific Findings → Action Items / Recommendations. Each slide must have a clear purpose and build on the previous one.

2. **Data Sourced from Audit Metrics**: All quantitative data must come from the `audit_history` MCP tool and fitness score records. This includes: total audits conducted, pass/fail rates, fitness score averages (7 components), trend direction (improving/declining), and top finding categories. No fabricated numbers.

3. **Charts or Tables for Quantitative Data**: Numerical data must be presented visually using tables, bar charts, line charts, or pie charts rather than walls of text. At minimum: one summary table (audit pass rates) and one trend visualization (fitness scores over time). Charts must have axis labels and legends.

4. **Consistent Slide Formatting**: All slides must use a consistent visual theme: same font family, consistent heading sizes, uniform color scheme, aligned content placement. Bullet points must use the same style throughout. No slides with clashing fonts or inconsistent margins.

5. **Valid PPTX Output**: The generated file must be a valid PPTX that opens without errors in Microsoft PowerPoint and LibreOffice Impress. The skill must use a proper PPTX library (e.g., pptxgenjs, python-pptx via subprocess, or officegen). The file must not be corrupt or empty.

6. **Appropriate Slide Density**: Each slide should contain a focused amount of content — no slide should have more than 6-7 bullet points or a single massive table. Complex data should be split across multiple slides. The total slide count should be proportional to the data available (typically 8-15 slides for a quarterly review).
