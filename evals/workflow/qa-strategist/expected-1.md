# Expected: Quality Strategy

## Procedure Steps

1. Read PRD/CPS for track context
2. Detect domains: security (payment), persistence (transactions), external (Stripe)
3. Select phases: Planning, Design, Implementation, Audit (all 4 for Tier 3)
4. Define criteria per phase:
   - Planning: MECE, FR traceability, FDE for payment failures
   - Design: Diagrams, naming, state machines for transaction lifecycle
   - Implementation: CQ/T/CC/S/I with S=absolute (payment security)
   - Audit: Confluence 4-point (mandatory for Tier 3), Amendment resolution
5. Adjust thresholds: security findings = 0 (absolute), coverage >= 90% (payment critical)
6. Include parliamentary checks: Confluence mandatory, Amendment gate
7. Output quality plan with mandatory gates and advisory checks
8. Delegate to: self-checker, gap-detector, specialist (security), confluence
