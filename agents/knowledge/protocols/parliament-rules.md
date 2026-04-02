# Parliament Rules — Quorum Deliberation Protocol

Standing rules governing all parliamentary sessions: consensus audit, diverge-converge deliberation, amendment voting, and confluence verification.

All roles (Advocate, Devil's Advocate, Judge, Specialist) are bound by these rules. Implementer has testimony rights but no vote.

---

## 1. Roles & Responsibilities

### Advocate

**Purpose**: Find merit. Argue for approval.

**Checklist** (evaluate ALL before verdict):
```
[ ] Evidence matches the claim — diff scope aligns with stated changes
[ ] Tests cover the stated scope — not just compilation, but behavioral verification
[ ] Implementation approach is sound — no obvious anti-patterns
[ ] Changed files are within declared target — no stealth modifications
[ ] Non-blocking issues (if any) are clearly advisory, not structural
```

**Verdict criteria**:
- `approved` — all checklist items pass, or failures are genuinely non-blocking
- `changes_requested` — any checklist item fails AND the failure is structural
- NEVER rubber-stamp: if you cannot articulate WHY it should pass, it should not pass

**Anti-patterns**:
- "Looks good to me" without addressing checklist → invalid verdict
- Ignoring Devil's findings without counter-argument → invalid verdict
- Approving with confidence < 0.6 → escalate instead

### Devil's Advocate

**Purpose**: Find weakness. Argue for rejection (constructively).

**Checklist** (evaluate ALL before verdict):
```
[ ] Root cause vs symptom — does the fix address the actual problem?
[ ] Scope integrity — are there undeclared changes, scope creep, or missing files?
[ ] Edge cases — what inputs/states are untested? What breaks at boundaries?
[ ] Security — OWASP Top 10 concerns? Injection? Auth bypass? Data exposure?
[ ] Regression — do existing tests still pass? Is prior functionality preserved?
[ ] Completeness — are there TODO/FIXME/placeholder markers left behind?
```

**Verdict criteria**:
- `changes_requested` — any checklist item fails with concrete evidence (file:line)
- `approved` — all checklist items pass after thorough examination
- NEVER reject without evidence: vague "I'm not comfortable" is insufficient
- Every rejection MUST include specific file:line references and a rejection code

**Anti-patterns**:
- Theoretical concerns without evidence → not a valid finding
- Rejecting because "it could be better" without specifying what → invalid
- Flagging issues outside the change scope → out of jurisdiction

### Judge

**Purpose**: Weigh arguments. Deliver binding verdict.

**Decision procedure**:
1. Read both opinions fully before forming judgment
2. If both agree → confirm, but add your own assessment (do not parrot)
3. If they disagree → evaluate by these criteria (in order):
   a. **Evidence quality**: File:line references outweigh vague concerns
   b. **Confidence delta**: If one role has ≥0.3 higher confidence, weight their argument
   c. **Checklist coverage**: Did both roles address their full checklist?
   d. **Root cause test**: Does the Devil's root-cause analysis hold up?
4. Announce verdict with explicit reasoning for which argument prevailed

**Tie-breaking rules** (when Advocate and Devil deadlock):
- Both `approved` → approved (unanimous)
- Both `changes_requested` → changes_requested (unanimous)
- Split verdict, Judge agrees with one → that verdict wins (2:1 majority)
- Split verdict, Judge disagrees with both → `changes_requested` (fail-safe default)
- All three different or abstain → `changes_requested` + escalation flag

**Anti-patterns**:
- Deciding without referencing both opinions → invalid
- Agreeing with the Advocate by default → bias
- Ignoring Devil's root-cause analysis without counter-evidence → invalid

### Specialist

**Purpose**: Domain-specific expertise. Advisory opinion with vote.

**Scope**: Review ONLY within assigned domain. Findings outside domain are informational, not binding.

**Output**: Follow `specialist-base.md` protocol. Confidence >= 0.8 threshold applies.

### Implementer

**Purpose**: Testimony only. No vote.

**Rights**:
- May submit testimony before deliberation begins (via `--testimony` or orchestrator context)
- May NOT respond to criticisms during deliberation
- May NOT vote on amendments affecting their own submission
- Testimony is context, not evidence — roles evaluate it like any other input

---

## 2. Voting Rules

### Quorum

- **Minimum voters**: 2 of 3 roles (Advocate + Devil or Advocate + Judge or Devil + Judge)
- If only 1 role responds → verdict is `infra_failure` (session incomplete)
- Specialist votes count toward quorum only in sessions with 4+ eligible voters

### Majority

| Amendment target | Required threshold | Rationale |
|-----------------|-------------------|-----------|
| WB (work breakdown) | Simple majority (>50%) | Tactical change, low blast radius |
| PRD (requirements) | Super-majority (≥66%) | Changes what we're building |
| Design (architecture) | Super-majority (≥66%) | Changes how we're building |
| Scope (project boundary) | Unanimous (100%) | Changes what's in/out entirely |

### Tie-breaking

- 2:1 split → majority wins
- 1:1 with abstain → `changes_requested` (fail-safe)
- All abstain → `infra_failure` (session needs re-run)

### Confidence Weighting

When roles disagree and confidence scores diverge significantly (delta ≥ 0.3):
- Higher-confidence opinion carries more weight in Judge's decision
- But Judge MUST explain why the lower-confidence argument was insufficient
- Confidence < 0.5 from any role → that role's verdict is treated as advisory, not binding

---

## 3. Evidence Standards

### Minimum Evidence Requirements

For a submission to be eligible for review, it MUST contain:

```
[ ] Diff or changed file list — what actually changed
[ ] Claim statement — what the author says they did
[ ] Verify result — output of the verify command (pass/fail + log)
[ ] Test result — at least one test runner output (not just tsc)
```

**Insufficient evidence → `infra_failure`**, not `changes_requested`. The distinction matters: `changes_requested` means "the work has problems", `infra_failure` means "we can't evaluate the work".

### Evidence Freshness

- Evidence older than the latest commit on reviewed files is **stale** — flag but don't auto-reject
- Test results from a different branch are **invalid** — reject

### Conflicting Evidence

- If test output contradicts diff (e.g., tests pass but diff shows broken code), flag as `changes_requested` with code `evidence-conflict`
- Author's claim vs actual diff mismatch → always trust the diff

---

## 4. Deliberation Procedure

### Round Structure

1. **Diverge phase** (parallel): Advocate and Devil analyze independently
   - No communication between roles during this phase
   - Each role produces a complete opinion covering their full checklist
   - Time budget: maxTurns / 2 per role (enforced by adapter frontmatter)

2. **Converge phase** (sequential): Judge synthesizes
   - Judge reads both opinions before responding
   - Judge produces verdict + 4 registers + 5-classification
   - Judge MUST reference both opinions explicitly

3. **Post-verdict**: Mechanical enforcement
   - `approved` → confluence check → amendment check → proceed
   - `changes_requested` → Fixer → re-audit (max 3 rounds)
   - `infra_failure` → log + skip (fail-open)

### Round Limits

- Default: 10 rounds maximum (configurable via `parliament.maxRounds`)
- Convergence detected → auto-stop (2 consecutive stable rounds)
- After round 7: "Do NOT introduce new items" instruction injected
- After maxRounds: force verdict from last Judge opinion

### Reopening

- New evidence (e.g., test failure discovered post-verdict) → new session, not reopening
- No mid-session reopening — complete the current session first

---

## 5. Amendment Rules

### Proposal

- Any role except Implementer may propose amendments
- Orchestrator may auto-propose from confluence failures (sponsor: "orchestrator", role: "judge")
- Each amendment MUST specify: target (PRD/design/WB/scope), change, justification
- Maximum 5 auto-amendments per session (configurable via `parliament.maxAutoAmendments`)

### Discussion

- Amendment is visible to all roles in the next deliberation round
- Roles vote during convergence phase (inline with other business)
- No separate amendment debate — integrated into regular rounds

### Voting

- Follows the threshold table in Section 2 (Majority)
- Implementer has testimony but no vote on amendments
- Vote positions: `for`, `against`, `abstain`
- Last vote wins (voter can change position before resolution)
- Deferred: if quorum not met after 2 rounds, amendment auto-deferred

### Resolution

- Approved → amendment takes effect immediately
- Rejected → amendment archived, cannot be re-proposed in same session
- Deferred → carried to next session, re-proposed automatically

### Mutual Exclusivity

- If two approved amendments contradict, the higher-threshold one prevails
- If same threshold, the later-proposed one prevails (it had more context)
- Contradiction detection is mechanical: amendments targeting the same section of the same document

---

## 6. Confluence Protocol

### When to Run

- After every `approved` verdict (automatic)
- On track completion (E2E verification)
- On explicit `/quorum:verify` invocation

### 4-Point Integrity Check

| Check | Question | Pass condition |
|-------|----------|---------------|
| Law ↔ Code | Does implementation match the audit verdict? | Latest verdict = `approved` |
| Part ↔ Whole | Do modules work together? | Integration tests pass |
| Intent ↔ Result | Does implementation solve the CPS problem? | CPS gaps addressed |
| Law ↔ Law | Do design decisions contradict each other? | No contradictions detected |

### Failure Actions

- Failed check → auto-propose amendment with justification from check detail
- 2+ failed checks → flag for human review (add `escalation: "human"` to event)
- All 4 pass → confluence verified, proceed to merge

---

## 7. Escalation Paths

### Deadlock (3+ failed audit rounds on same items)

1. Stagnation detector fires (spinning/oscillation/no-progress)
2. If `recommendation === "halt"` → break fix loop, rollback wave
3. Log stagnation event with pattern type for auto-learn
4. Next session: auto-learn feeds stagnation pattern into trigger scoring

### Irreconcilable Disagreement (Judge cannot resolve Advocate vs Devil)

1. Judge sets verdict `changes_requested` with code `irreconcilable`
2. Escalation flag added to event
3. Session handoff includes the disagreement summary
4. Human reviews in next session

### Repeated Amendment Failure

1. Same amendment proposed and rejected 2+ times → auto-archive
2. Log as `amendment.exhausted` event
3. Cannot be re-proposed without human override (`--force`)

---

## 8. Recusal & Conflict of Interest

### Automatic Recusal

- Implementer CANNOT vote on amendments affecting files they authored in the current track
- A role using the same model as the implementer SHOULD be flagged (cross-model preferred)

### Voluntary Recusal

- Any role may `abstain` on any vote with reason
- Abstention counts toward quorum (participation) but not toward majority (decision)

---

## 9. Session Records

### What is Recorded (EventStore)

- Every role opinion (verdict, reasoning, codes, confidence)
- Every amendment (proposal, votes, resolution)
- Every convergence check (registers, classifications, delta)
- Every CPS generation (context, problem, solution)
- Session metadata (start, end, rounds, participants, mode)

### What is NOT Recorded

- Internal LLM reasoning chains (only final output)
- Draft opinions that were revised before submission
- Inter-role communication (roles are independent)

### Retention

- All events are append-only (EventStore WAL)
- No deletion — historical record is permanent
- Session transcripts available via `quorum parliament --history`
