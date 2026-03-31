# Work Catalog - Remote Autonomy v1

| ID | Title | Size | Phase | Status | Dependencies |
|----|-------|------|-------|--------|--------------|
| RAI-1 | Define remote session state contract and bridge transport | M | Phase 0 | done | none |
| RAI-2 | Add authenticated remote approval callbacks through gate and ledger | M | Phase 0 | done | RAI-1 |
| RAI-3 | Build idle-only scheduler with 15s autonomy budget and cooldowns | M | Phase 1 | done | RAI-1 |
| RAI-4 | Register safe proactive jobs and forbid unattended source-code mutation | M | Phase 1 | done | RAI-3 |
| RAI-5 | Add prompt cache-safe autonomy context and cache break telemetry | M | Phase 2 | done | RAI-4 |
| RAI-6 | Add content replacement and full artifact fetch for large tool results | M | Phase 2 | done | RAI-4 |
| RAI-7 | Add bounded file state cache for repeated autonomy and remote reads | S | Phase 2 | done | RAI-4 |
| RAI-8 | Build remote operator UI surface for status, approvals, jobs, and digests | M | Phase 3 | done | RAI-2, RAI-5 |
| RAI-9 | Add optional UDS or bridge inbox for async cross-session messages | S | Phase 4 | done | RAI-1 |
| RAI-10 | Final integration review for remote autonomy rollout | S | Phase 5 | done | RAI-5, RAI-6, RAI-7, RAI-8, RAI-9 |
