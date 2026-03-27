# Expected Quality Standards — Mermaid Diagram

1. **Valid Mermaid Syntax**: The output must be a parseable mermaid diagram enclosed in a ```mermaid code block. Running it through a mermaid parser (e.g., mermaid-js or mermaid.live) should produce zero parse errors.

2. **Correct Diagram Type**: The diagram must use `sequenceDiagram` as the diagram type, since the prompt describes a sequential process flow with distinct actors and message passing.

3. **Participant Declarations**: All key actors in the audit flow must be declared as participants. At minimum: Agent (or Hook), TriggerEngine, DomainDetector, Consensus (or Auditor), and EventStore (or SQLite). Participant aliases should be concise and readable.

4. **Accurate Message Flow**: The arrows must reflect the correct order of operations:
   - Evidence submission (agent → trigger)
   - Trigger evaluation (trigger decision: T1 skip / T2 simple / T3 deliberative)
   - Domain detection (file patterns → specialist activation)
   - Consensus deliberation (advocate, devil, judge roles)
   - Verdict storage (result → SQLite event store)

5. **No Syntax Errors**: No unclosed blocks, no missing arrow operators (`->>`, `-->>`, `->>`), no invalid keywords, no unmatched `activate`/`deactivate` pairs, no duplicate participant names.

6. **Logical Participant Ordering**: Participants should be ordered left-to-right following the data flow direction (submitter on the left, storage on the right), making the diagram easy to read top-to-bottom.

7. **Appropriate Use of Mermaid Features**: The diagram should use relevant mermaid features such as:
   - `alt`/`else` blocks for branching (e.g., tier routing)
   - `activate`/`deactivate` for showing processing time
   - `Note` annotations for clarifying key decision points
   - Return arrows (`-->>`) for responses vs. request arrows (`->>`)
