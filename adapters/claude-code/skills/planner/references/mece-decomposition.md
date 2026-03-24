# MECE Decomposition Guide

## Purpose

After capturing user intent (Phase 1) and before writing the PRD (Phase 2), perform a structured 3-step decomposition to ensure requirements are Mutually Exclusive and Collectively Exhaustive.

## When to Apply

Apply MECE decomposition when:
- New product/feature planning (not minor adjustments)
- User request involves multiple stakeholders or systems
- Scope is ambiguous or potentially incomplete

## Step 1: Actor Decomposition (ME — No Role Overlap)

Identify every stakeholder who interacts with the system.

| Actor | Mentioned? | Derivation | Required Systems |
|-------|:----------:|------------|-----------------|
| (name) | ✓/✗ | (why needed) | (what they need) |

**ME Check**: No two actors have the same responsibility.
**CE Check**: "Is there anyone else who interacts with this system?"

### Common Missing Actors
- **Admin/Ops**: Who manages the system? Who handles exceptions?
- **External systems**: APIs, payment gateways, notification services
- **Auditor/Compliance**: Who verifies correctness?

## Step 2: System Decomposition (ME — Clear Boundaries)

For each Actor, derive the systems they need.

| System | Category | Actor | Derivation |
|--------|----------|-------|-----------|
| (name) | Frontend/Backend/Service | (actor) | (why needed) |

**ME Check**: No two systems serve the same purpose.
**CE Check**: "Can every Actor accomplish all their tasks with these systems?"

### Common Missing Systems
- **Payment/Billing**: If money is involved
- **Notification**: If status changes need to be communicated
- **Analytics/Monitoring**: If operations team exists
- **Authentication**: If multiple actors access the system

## Step 3: Domain Coverage (CE — No Cross-Cutting Concern Missing)

For each system, check cross-cutting concerns.

| Domain | Applicable? | Evidence |
|--------|:-----------:|---------|
| Security | ✓/✗/? | (auth, encryption, PII) |
| Persistence | ✓/✗/? | (database, storage) |
| Error Handling | ✓/✗/? | (failure scenarios) |
| Observability | ✓/✗/? | (logging, metrics, tracing) |
| i18n | ✓/✗/? | (multi-language support) |
| Accessibility | ✓/✗/? | (screen reader, WCAG) |
| Performance | ✓/✗/? | (latency, throughput) |
| Compliance | ✓/✗/? | (GDPR, licenses) |

**"?" means "ask the user"** — do not assume.

## Output

Present the complete Actor Map + System Map + Domain Checklist to the user **before proceeding to Phase 2 (PRD)**.

> "Based on your request, I've identified N actors, M systems, and the following domain coverage.
> [tables]
> Are there any actors or systems I'm missing? Any domains you want to explicitly exclude?"

## Anti-Patterns

- Do NOT skip Actor decomposition — "just one user" is rarely true
- Do NOT assume domains are in/out of scope — ask when uncertain (mark as ?)
- Do NOT proceed to PRD with unresolved "?" domains — get explicit confirmation
- Do NOT duplicate actors (e.g., "admin" and "operator" doing the same thing)
