# Work Catalog - Retro Intelligence v1

| ID | Title | Size | Phase | Status | Dependencies |
|----|-------|------|-------|--------|--------------|
| RDI-1 | Split retro gate state from consolidation state and define 3-gate trigger policy | M | Phase 0 | done | none |
| RDI-2 | Add consolidation lock with stale reclaim and rollback semantics | S | Phase 0 | done | RDI-1 |
| RDI-3 | Build deterministic orient/gather signal adapters for retro consolidation | M | Phase 1 | done | RDI-1, RDI-2 |
| RDI-4 | Generate deterministic RetroDigest and explicit prune journal | M | Phase 1 | done | RDI-3 |
| RDI-5 | Wire manual and auto Dream execution surfaces to shared engine | M | Phase 2 | done | RDI-2, RDI-4 |
| RDI-6 | Feed RetroDigest into wave compact and next-wave prompt context | M | Phase 2 | done | RDI-4 |
| RDI-7 | Surface dream status and digest summaries in daemon state and event views | S | Phase 3 | done | RDI-4 |
| RDI-8 | Add optional LLM-assisted consolidation upgrader with deterministic fallback | S | Phase 3 | done | RDI-4 |
| RDI-9 | Final integration review for retro intelligence rollout | S | Phase 4 | done | RDI-5, RDI-6, RDI-7, RDI-8 |
