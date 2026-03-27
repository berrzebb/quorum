# Expected: Failure Analysis Pipeline

## Procedure Steps

1. Read PRD to identify P0/P1 FRs (FR-1, FR-2; skip FR-3 as P2)
2. For FR-1 (Payment Processing), generate failure scenarios:
   - External: Stripe API timeout, rate limiting, auth key expiry
   - Data: Duplicate charge, race condition on concurrent payments
   - Input: Invalid card format, amount overflow, currency mismatch
   - Infrastructure: Network partition during payment confirmation
3. For FR-2 (Refund), generate failure scenarios:
   - External: Stripe refund API unavailable
   - Data: Refund exceeds original amount, already-refunded transaction
   - Input: Expired refund window, invalid transaction ID
4. Classify each scenario (HIGH/MEDIUM/LOW)
5. For HIGH severity (e.g., duplicate charge, network partition): create mandatory new WBs
6. For MEDIUM severity (e.g., rate limiting): create new WBs with deferral option
7. Define concrete mitigations (idempotency keys, retry with backoff, amount validation)
8. Present failure tables per FR
9. Present derived WB summary
10. Wait for user confirmation before adding WBs
