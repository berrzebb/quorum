# Expected Quality Standards — General Report

1. **Full Track Lifecycle Coverage**: The report must cover all phases of the track's lifecycle: Planning (PRD, WB generation), Implementation (wave execution, agent activity), Audit (verdict outcomes per wave), and Retrospective (learnings, pattern analysis). Omitting any phase makes the report incomplete.

2. **Quantitative Metrics**: The report must include hard numbers sourced from actual data:
   - Total WB items and completion count
   - Test count (added/modified during the track)
   - Fitness score at track start vs. end (composite and per-component if available)
   - Audit pass rate (passes / total audits)
   - Number of Fixer rounds triggered
   - Lines of code added/modified (if available from git)

3. **Qualitative Learnings**: Beyond numbers, the report must include narrative analysis:
   - What patterns caused audit failures (common finding categories)
   - What stagnation patterns were detected (if any)
   - What auto-learning rules were suggested
   - What went well vs. what needs improvement
   - Recommendations for future tracks of similar scope

4. **Structured Markdown Format**: The report must use well-organized markdown with a clear hierarchy:
   - H1: Report title (including track name and date)
   - H2: Major sections (Overview, Planning, Implementation, Audit Results, Fitness Analysis, Learnings, Recommendations)
   - H3: Subsections within each major section
   - Tables for tabular data (WB status, audit verdicts)
   - Lists for findings and recommendations

5. **Data Sourced from Track Records**: All data must come from actual track records: `audit_history` for verdicts, fitness score events from the event store, planning files from `.claude/quorum/planning/`, and wave state from `wave-state-{track}.json`. The report must not contain fabricated data or generic boilerplate.

6. **Timeline or Chronological Narrative**: The report must include a temporal dimension — either a timeline table (date, event, outcome) or a chronological narrative that shows how the track progressed over time. This helps readers understand the sequence of events and identify bottlenecks.

7. **Actionable Takeaways**: The report must end with concrete, actionable recommendations — not vague suggestions. Examples: "Add integration tests for auth middleware before next audit," "Split WB-3 into two items (>5 files)," "Enable security domain specialist for routes/ files." Each recommendation should reference specific evidence from the report.
