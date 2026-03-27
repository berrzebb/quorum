# Planner Expected Output Quality Standards

## 1. PRD Section Completeness

The PRD output MUST contain all 4 mandatory sections:

- **Goals**: Clear project objectives tied to the authentication feature
- **Requirements**: Functional requirements (FR-1, FR-2, ...) with testable acceptance criteria
- **Scope**: Explicit in-scope and out-of-scope boundaries
- **Constraints**: Technical constraints (Node.js, TypeScript, PostgreSQL, JWT)

## 2. WB Action + Verify Fields

Every Work Breakdown item MUST include:

- **Action**: Concrete implementation step describing what to do
- **Verify**: Testable verification command or condition (e.g., `npm test`, curl command, assertion)
- Missing Action or Verify fields constitute a blocking failure

## 3. Phase/GATE Hierarchy Correctness

- WB items are grouped under Phase parents (Phase 1, Phase 2, ...)
- GATE-N references resolve to valid Phase parent indices
- Phase N items MUST complete before Phase N+1 items can begin
- `dependsOn` fields reference valid GATE-N or sibling WB identifiers

## 4. FDE Failure Checklists

- Each functional requirement (FR) has an associated FDE (Failure-Driven Enumeration) checklist
- Checklists enumerate specific failure modes (e.g., "JWT expired but not refreshed", "bcrypt cost factor too low")
- At least 2 failure modes per FR

## 5. MECE Decomposition Coverage

The Phase 1.5 decomposition MUST cover three layers:

- **Actor**: End user, admin, system (automated processes)
- **System**: Auth service, email service, database, rate limiter
- **Domain**: Security (hashing, tokens), Persistence (user records), Communication (email)

No overlaps (mutually exclusive) and no gaps (collectively exhaustive).

## 6. Structural Integrity

- WB headings include Size estimation (XS, S, or M)
- `targetFiles` lists concrete file paths (e.g., `src/auth/login.ts`)
- WB count is reasonable for scope (6-15 items for this feature)
- No WB item targets more than 5 files (split guard)
- Design Phase is present and naming conventions are defined before WB generation
