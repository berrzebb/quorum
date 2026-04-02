# FDE Checklist Guide

## Purpose

After DRM confirmation (Phase 5) and before writing Work Breakdowns, analyze each FR for failure scenarios. This ensures WB items cover error handling and edge cases, not just the happy path.

## When to Apply

Apply FDE checklist for:
- Every FR with Priority P0 or P1
- Any FR involving external dependencies (APIs, services, hardware)
- Any FR involving user input or data persistence

## Process

For each applicable FR, build a failure table:

| Failure Scenario | Severity | Impact | Mitigation Strategy | New WB? |
|-----------------|:--------:|--------|--------------------:|:-------:|
| (what can fail) | H/M/L | (who is affected) | (how to handle) | ✓/✗ |

### Severity Criteria

| Severity | Definition | Example |
|----------|-----------|---------|
| **HIGH** | System unusable or data loss | Payment fails silently, user charged twice |
| **MEDIUM** | Degraded experience, workaround exists | Map doesn't load, but address entry works |
| **LOW** | Minor inconvenience | Loading spinner shows 1s longer than expected |

## Common Failure Categories

### External Dependencies
- API timeout / unavailable
- Rate limiting
- Response format change
- Authentication token expiry

### Data & Persistence
- Duplicate records
- Concurrent writes (race conditions)
- Schema migration failure
- Data corruption / inconsistency

### User Input
- Invalid format
- Injection attacks (XSS, SQL)
- Exceeding size limits
- Unexpected encoding

### Infrastructure
- Network partition
- Disk full
- Memory exhaustion
- Container restart during operation

## Output

For each FR, present the failure table and highlight new WBs derived from failure analysis:

> "FR-3 (Real-time location tracking) failure analysis identified 2 additional WB items:
> - WB-7: GPS signal loss fallback (cache last location + UI indicator)
> - WB-8: WebSocket reconnection with polling fallback
>
> Should I add these to the work breakdown?"

## Rules

1. **HIGH severity failures MUST have a WB** — they cannot be deferred
2. **MEDIUM severity failures SHOULD have a WB** — unless explicitly deferred by user
3. **LOW severity failures MAY be noted** — included in existing WB as implementation detail
4. **Every mitigation must be testable** — "handle gracefully" is not a mitigation
5. **FDE checklist is per-FR, not per-WB** — one FR may generate multiple failure WBs

## Anti-Patterns

- Do NOT skip external dependency failures — they are the #1 source of production incidents
- Do NOT mark HIGH severity as "deferred" — escalate to user if they try
- Do NOT generate WBs for impossible scenarios — focus on realistic failures
- Do NOT duplicate mitigations across FRs — reference shared WBs instead
